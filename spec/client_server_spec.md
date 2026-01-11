# Client/Server Specification (Current Behavior)

This document captures the observed behavior of the current Python client and server implementations, based solely on:

- `Code/Server/server.py`
- `Code/Client/Main.py`

It is intended as a baseline spec for re-engineering the client/server split.

## 1. High-level architecture

- **Server**
  - Runs two TCP servers: one for **command/control** traffic and one for **video** traffic.
  - Determines its bind address from the `wlan0` interface (falling back to `127.0.0.1`).
  - Exposes helper APIs to send/receive data on both channels and track connection/busy state.

- **Client**
  - PyQt5 GUI application.
  - Uses a `VideoStreaming` helper class to manage TCP connectivity, video streaming, and command I/O.
  - Sends command strings over a TCP channel and receives status updates (power, light, ultrasonic).
  - Spawns background threads for video streaming and command reception.

## 2. Server behavior (`Code/Server/server.py`)

### 2.1 Network interfaces and binding

- On startup, the server obtains the IPv4 address of the `wlan0` network interface via an `ioctl` call.
- If interface discovery fails, it defaults to `127.0.0.1`.

### 2.2 TCP servers

- **Command server**
  - `TCPServer` instance stored as `self.command_server`.
  - Default port when started in `__main__`: **5000**.

- **Video server**
  - `TCPServer` instance stored as `self.video_server`.
  - Default port when started in `__main__`: **8000**.

- `start_tcp_servers(command_port=5000, video_port=8000, max_clients=1, listen_count=1)` starts both servers on the same IP.

### 2.3 Message flow

- Server exposes a queue for each TCP server: `message_queue` inside each `TCPServer` instance.
- The example main loop:
  - Pulls `(client_address, message)` from each queue when available.
  - Echoes the message back to the originating client.

### 2.4 Busy state and connection state

- Server tracks busy flags:
  - `command_server_is_busy` and `video_server_is_busy`.
- Server exposes helper methods:
  - `is_command_server_connected()` / `is_video_server_connected()` based on `active_connections > 0`.
  - `get_command_server_client_ips()` / `get_video_server_client_ips()` to list connected clients.

### 2.5 Data sending

- `send_data_to_command_client(data, ip_address=None)`
  - If `ip_address` is provided, sends to a specific client; otherwise broadcasts to all command clients.
- `send_data_to_video_client(data, ip_address=None)`
  - Same behavior for the video server.

## 3. Client behavior (`Code/Client/Main.py`)

### 3.1 Startup and UI

- Creates a frameless, always-on-top PyQt5 window (`mywindow`).
- Loads the last-used server IP address from `IP.txt` into the IP input field.
- Initializes servo positions (both set to 90 degrees).
- Creates an instance of `VideoStreaming` (`self.TCP`) which owns socket/streaming logic.

### 3.2 Connection lifecycle

#### Connect

When the **Connect** button is pressed:

1. The current IP entry is read into `self.h`.
2. `self.TCP.StartTcpClient(self.h)` is invoked to initialize socket state.
3. The IP is written back to `IP.txt` for persistence.
4. Two threads are started:
   - `self.streaming`: runs `self.TCP.streaming(self.h)` (video receive loop).
   - `self.recv`: runs `self.recvmassage()` (command/status receive loop).
5. Button label changes to **Disconnect**.

#### Disconnect

When the **Disconnect** button is pressed:

1. UI toggles to **Connect**.
2. Background threads are stopped (best-effort) via `stop_thread`.
3. `self.TCP.StopTcpcClient()` is called to close TCP connections.

#### Window close

On window close:

- Stops the timer and threads.
- Stops the TCP client.
- Deletes `video.jpg` if present.
- Exits the application.

### 3.3 Command sending format

- Client builds command strings using:
  - `endChar = '\n'`
  - `intervalChar = '#'`
- Example pattern:
  - `CMD_LED_MOD#<value>\n`
- The client uses `self.TCP.sendData(...)` to transmit command strings.

### 3.4 Periodic power requests

- The `Power` thread periodically sends `CMD_POWER\n` every 60 seconds.
- This starts in `recvmassage()` after connecting.

### 3.5 Command/status reception

`recvmassage()` implements the receive loop:

1. `self.TCP.socket1_connect(self.h)` is called (separate from `StartTcpClient`).
2. Starts the `Power` thread.
3. Reads raw data via `self.TCP.recvData()`.
4. Accumulates data into a `restCmd` buffer to handle partial lines.
5. Splits by newline into individual commands.
6. Parses each command by `#`:
   - **Ultrasonic** (`CMD_SONIC`): emits `Obstruction:<distance> cm`.
   - **Light** (`CMD_LIGHT`): emits `Left:<v>V Right:<v>V`.
   - **Power** (`CMD_POWER`): computes battery percentage using `((value - 7) / 1.40 * 100)`.

### 3.6 Video display loop

- A GUI timer periodically:
  - Updates `self.label_Video` from `video.jpg` if it exists and validates as a JPG.
  - If face tracking is enabled, uses `self.TCP.face_x` / `self.TCP.face_y` to update servo sliders.

### 3.7 Control inputs

- UI button presses translate to command sends using values from `Command.COMMAND`.
- Keyboard arrows map to directional button handlers.
- LED, servo, mode, buzzer, and movement commands are sent using `self.TCP.sendData` with the command format described above.

## 4. Observed protocol assumptions

- **Transport**: TCP.
- **Two channels**: one for command/status traffic, one for video.
- **Message framing**: newline-delimited messages (`\n`).
- **Field separator**: `#` between command token and arguments.

## 5. Re-engineering notes (implicit constraints)

- The server expects to run on the robot device and discover a wireless IP on `wlan0`.
- The client expects an IP address stored in `IP.txt` and reuses it on startup.
- Commands and status are string-based; any new implementation should preserve newline framing and `#`-delimited fields to remain compatible.
- The GUI depends on a `video.jpg` file updated by the streaming thread.
