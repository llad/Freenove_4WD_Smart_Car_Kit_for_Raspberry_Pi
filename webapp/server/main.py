from __future__ import annotations

import socket
import struct
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


CLIENT_DIR = Path(__file__).resolve().parents[1] / "client"


class ConnectRequest(BaseModel):
    ip: str = Field(..., description="Robot IP address")


class CommandRequest(BaseModel):
    command: str = Field(..., description="Raw command string to send")


class StateResponse(BaseModel):
    connected: bool
    ip: Optional[str]
    power_percent: Optional[int]
    ultrasonic_cm: Optional[float]
    light_left_v: Optional[float]
    light_right_v: Optional[float]
    last_command: Optional[str]
    last_status: Optional[str]


@dataclass
class RobotState:
    connected: bool = False
    ip: Optional[str] = None
    power_percent: Optional[int] = None
    ultrasonic_cm: Optional[float] = None
    light_left_v: Optional[float] = None
    light_right_v: Optional[float] = None
    last_command: Optional[str] = None
    last_status: Optional[str] = None
    last_frame: Optional[bytes] = None
    last_frame_time: Optional[float] = None


@dataclass
class RobotBridge:
    state: RobotState = field(default_factory=RobotState)
    command_socket: Optional[socket.socket] = None
    video_socket: Optional[socket.socket] = None
    command_thread: Optional[threading.Thread] = None
    video_thread: Optional[threading.Thread] = None
    power_thread: Optional[threading.Thread] = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    running: bool = False

    def connect(self, ip: str) -> None:
        self.disconnect()
        with self.lock:
            self.state.ip = ip
            self.state.connected = False
            self.state.last_status = None
        self.command_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.video_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.command_socket.settimeout(2)
        self.video_socket.settimeout(3)
        try:
            self.command_socket.connect((ip, 5000))
            self.video_socket.connect((ip, 8000))
        except OSError:
            self.disconnect()
            raise
        with self.lock:
            self.state.connected = True
        self.running = True
        self.command_thread = threading.Thread(target=self._command_loop, daemon=True)
        self.video_thread = threading.Thread(target=self._video_loop, daemon=True)
        self.power_thread = threading.Thread(target=self._power_loop, daemon=True)
        self.command_thread.start()
        self.video_thread.start()
        self.power_thread.start()

    def disconnect(self) -> None:
        self.running = False
        if self.command_socket:
            try:
                self.command_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.command_socket.close()
        if self.video_socket:
            try:
                self.video_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.video_socket.close()
        self.command_socket = None
        self.video_socket = None
        with self.lock:
            self.state.connected = False
            self.state.last_status = "Disconnected"

    def send_command(self, command: str) -> None:
        if not self.command_socket or not self.state.connected:
            raise RuntimeError("Command socket is not connected")
        payload = command.encode("utf-8")
        self.command_socket.sendall(payload)
        with self.lock:
            self.state.last_command = command.strip()

    def _power_loop(self) -> None:
        while self.running:
            time.sleep(60)
            if not self.running:
                break
            try:
                self.send_command("CMD_POWER\n")
            except (OSError, RuntimeError):
                continue

    def _command_loop(self) -> None:
        buffer = ""
        while self.running:
            if not self.command_socket:
                break
            try:
                data = self.command_socket.recv(1024)
            except socket.timeout:
                continue
            except OSError:
                break
            if not data:
                break
            buffer += data.decode("utf-8", errors="ignore")
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                self._handle_status_line(line)
        self.disconnect()

    def _handle_status_line(self, line: str) -> None:
        parts = line.split("#")
        with self.lock:
            self.state.last_status = line
        if not parts:
            return
        cmd = parts[0]
        if cmd == "CMD_SONIC" and len(parts) > 1:
            try:
                distance = float(parts[1])
            except ValueError:
                return
            with self.lock:
                self.state.ultrasonic_cm = distance
        elif cmd == "CMD_LIGHT" and len(parts) > 2:
            try:
                left = float(parts[1])
                right = float(parts[2])
            except ValueError:
                return
            with self.lock:
                self.state.light_left_v = left
                self.state.light_right_v = right
        elif cmd == "CMD_POWER" and len(parts) > 1:
            try:
                value = float(parts[1])
            except ValueError:
                return
            percent = int(max(0, min(100, ((value - 7) / 1.40) * 100)))
            with self.lock:
                self.state.power_percent = percent

    def _recv_exact(self, sock: socket.socket, length: int) -> Optional[bytes]:
        data = b""
        while len(data) < length and self.running:
            try:
                chunk = sock.recv(length - len(data))
            except socket.timeout:
                continue
            except OSError:
                return None
            if not chunk:
                return None
            data += chunk
        return data

    def _video_loop(self) -> None:
        while self.running:
            if not self.video_socket:
                break
            header = self._recv_exact(self.video_socket, 4)
            if not header:
                break
            frame_length = struct.unpack("<L", header)[0]
            if frame_length <= 0:
                continue
            frame = self._recv_exact(self.video_socket, frame_length)
            if not frame:
                break
            with self.lock:
                self.state.last_frame = frame
                self.state.last_frame_time = time.time()
        self.disconnect()


app = FastAPI(title="Freenove 4WD Web App")
bridge = RobotBridge()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/connect")
def connect(req: ConnectRequest) -> dict:
    try:
        bridge.connect(req.ip)
    except OSError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"connected": True, "ip": req.ip}


@app.post("/api/disconnect")
def disconnect() -> dict:
    bridge.disconnect()
    return {"connected": False}


@app.post("/api/command")
def send_command(req: CommandRequest) -> dict:
    try:
        bridge.send_command(req.command)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"sent": True}


@app.get("/api/state", response_model=StateResponse)
def get_state() -> StateResponse:
    with bridge.lock:
        return StateResponse(
            connected=bridge.state.connected,
            ip=bridge.state.ip,
            power_percent=bridge.state.power_percent,
            ultrasonic_cm=bridge.state.ultrasonic_cm,
            light_left_v=bridge.state.light_left_v,
            light_right_v=bridge.state.light_right_v,
            last_command=bridge.state.last_command,
            last_status=bridge.state.last_status,
        )


@app.get("/api/frame")
def get_frame() -> Response:
    with bridge.lock:
        frame = bridge.state.last_frame
    if not frame:
        raise HTTPException(status_code=404, detail="No frame available")
    return Response(frame, media_type="image/jpeg")


@app.get("/")
def root() -> HTMLResponse:
    return HTMLResponse((CLIENT_DIR / "index.html").read_text(encoding="utf-8"))


app.mount("/static", StaticFiles(directory=CLIENT_DIR), name="static")
