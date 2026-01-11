const state = {
  connected: false,
  ultrasonicEnabled: false,
  lightEnabled: false,
  buzzerEnabled: false,
};

const elements = {
  ipInput: document.getElementById("robot-ip"),
  connectBtn: document.getElementById("connect-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  connectionStatus: document.getElementById("connection-status"),
  powerStatus: document.getElementById("power-status"),
  ultrasonicStatus: document.getElementById("ultrasonic-status"),
  lightStatus: document.getElementById("light-status"),
  lastCommand: document.getElementById("last-command"),
  lastStatus: document.getElementById("last-status"),
  videoFeed: document.getElementById("video-feed"),
  videoPlaceholder: document.getElementById("video-placeholder"),
  wheelType: document.getElementById("wheel-type"),
  rotateMode: document.getElementById("rotate-mode"),
  servoLeft: document.getElementById("servo-left"),
  servoLeftValue: document.getElementById("servo-left-value"),
  servoUp: document.getElementById("servo-up"),
  servoUpValue: document.getElementById("servo-up-value"),
  sonicToggle: document.getElementById("sonic-toggle"),
  lightToggle: document.getElementById("light-toggle"),
  powerRequest: document.getElementById("power-request"),
  buzzerToggle: document.getElementById("buzzer-toggle"),
  rawCommand: document.getElementById("raw-command"),
  sendRaw: document.getElementById("send-raw"),
};

const postJson = async (url, payload) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  return response.json();
};

const sendCommand = async (command) => {
  await postJson("/api/command", { command });
};

const formatCommand = (cmd, ...parts) => {
  return `${cmd}#${parts.join("#")}\n`;
};

const movementCommands = {
  mecanum: {
    rotate: {
      forward: () => formatCommand("CMD_M_MOTOR", 0, 1500, 0, 0),
      backward: () => formatCommand("CMD_M_MOTOR", 180, 1500, 0, 0),
      left: () => formatCommand("CMD_M_MOTOR", 0, 0, 90, 1500),
      right: () => formatCommand("CMD_M_MOTOR", 0, 0, -90, 1500),
      stop: () => formatCommand("CMD_M_MOTOR", 0, 0, 0, 0),
      "move-left": () => formatCommand("CMD_M_MOTOR", 90, 1500, 0, 0),
      "move-right": () => formatCommand("CMD_M_MOTOR", -90, 1500, 0, 0),
      "diag-left": () => formatCommand("CMD_M_MOTOR", 45, 1500, 0, 0),
      "diag-right": () => formatCommand("CMD_M_MOTOR", -45, 1500, 0, 0),
      "diag-down-left": () => formatCommand("CMD_M_MOTOR", 135, 1500, 0, 0),
      "diag-down-right": () => formatCommand("CMD_M_MOTOR", -135, 1500, 0, 0),
    },
    translate: {
      forward: () => formatCommand("CMD_CAR_ROTATE", 0, 0, 0, 1500),
      backward: () => formatCommand("CMD_CAR_ROTATE", 0, 0, 180, 1500),
      left: () => formatCommand("CMD_CAR_ROTATE", 0, 0, 90, 1500),
      right: () => formatCommand("CMD_CAR_ROTATE", 0, 0, -90, 1500),
      stop: () => formatCommand("CMD_CAR_ROTATE", 0, 0, 0, 0),
      "move-left": () => formatCommand("CMD_CAR_ROTATE", 0, 0, 90, 1500),
      "move-right": () => formatCommand("CMD_CAR_ROTATE", 0, 0, -90, 1500),
      "diag-left": () => formatCommand("CMD_CAR_ROTATE", 0, 0, 135, 1500),
      "diag-right": () => formatCommand("CMD_CAR_ROTATE", 0, 0, 135, 1500),
      "diag-down-left": () => formatCommand("CMD_CAR_ROTATE", 0, 0, 135, 1500),
      "diag-down-right": () => formatCommand("CMD_CAR_ROTATE", 0, 0, -135, 1500),
    },
  },
  ordinary: {
    forward: () => formatCommand("CMD_MOTOR", 1500, 1500, 1500, 1500),
    backward: () => formatCommand("CMD_MOTOR", -1500, -1500, -1500, -1500),
    left: () => formatCommand("CMD_MOTOR", -1500, -1500, 1500, 1500),
    right: () => formatCommand("CMD_MOTOR", 1500, 1500, -1500, -1500),
    stop: () => formatCommand("CMD_MOTOR", 0, 0, 0, 0),
  },
};

const updateConnectionStatus = (connected, ip) => {
  state.connected = connected;
  elements.connectionStatus.textContent = connected
    ? `Connected to ${ip}`
    : "Disconnected";
};

const updateVideo = () => {
  if (!state.connected) {
    elements.videoFeed.src = "";
    elements.videoPlaceholder.style.display = "flex";
    return;
  }
  elements.videoFeed.src = `/api/frame?cache=${Date.now()}`;
  elements.videoFeed.onload = () => {
    elements.videoPlaceholder.style.display = "none";
  };
  elements.videoFeed.onerror = () => {
    elements.videoPlaceholder.style.display = "flex";
  };
};

const pollState = async () => {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    updateConnectionStatus(data.connected, data.ip || "");
    elements.powerStatus.textContent =
      data.power_percent !== null ? `${data.power_percent}%` : "--";
    elements.ultrasonicStatus.textContent =
      data.ultrasonic_cm !== null ? `${data.ultrasonic_cm} cm` : "--";
    elements.lightStatus.textContent =
      data.light_left_v !== null && data.light_right_v !== null
        ? `Left ${data.light_left_v}V / Right ${data.light_right_v}V`
        : "--";
    elements.lastCommand.textContent = data.last_command || "--";
    elements.lastStatus.textContent = data.last_status || "--";
  } catch (error) {
    console.warn(error);
  }
};

const handleMovement = async (action) => {
  const wheelType = elements.wheelType.value;
  if (wheelType === "ordinary") {
    const command = movementCommands.ordinary[action]?.();
    if (command) {
      await sendCommand(command);
    }
    return;
  }
  const mode = elements.rotateMode.checked ? "rotate" : "translate";
  const command = movementCommands.mecanum[mode][action]?.();
  if (command) {
    await sendCommand(command);
  }
};

const setupMovementButtons = () => {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("mousedown", async () => {
      const action = button.dataset.action;
      await handleMovement(action);
    });
    button.addEventListener("touchstart", async () => {
      const action = button.dataset.action;
      await handleMovement(action);
    });
  });
};

const setupLEDButtons = () => {
  document.querySelectorAll("[data-led-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.ledMode;
      await sendCommand(formatCommand("CMD_LED_MOD", mode));
    });
  });
};

const setupDriveModeButtons = () => {
  document.querySelectorAll("[data-drive-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.driveMode;
      await sendCommand(formatCommand("CMD_MODE", mode));
    });
  });
};

const setupServoControls = () => {
  elements.servoLeft.addEventListener("input", async () => {
    elements.servoLeftValue.textContent = elements.servoLeft.value;
    await sendCommand(formatCommand("CMD_SERVO", 0, elements.servoLeft.value));
  });
  elements.servoUp.addEventListener("input", async () => {
    elements.servoUpValue.textContent = elements.servoUp.value;
    await sendCommand(formatCommand("CMD_SERVO", 1, elements.servoUp.value));
  });
};

const setupToggles = () => {
  elements.sonicToggle.addEventListener("click", async () => {
    state.ultrasonicEnabled = !state.ultrasonicEnabled;
    await sendCommand(formatCommand("CMD_SONIC", state.ultrasonicEnabled ? 1 : 0));
  });
  elements.lightToggle.addEventListener("click", async () => {
    state.lightEnabled = !state.lightEnabled;
    await sendCommand(formatCommand("CMD_LIGHT", state.lightEnabled ? 1 : 0));
  });
  elements.powerRequest.addEventListener("click", async () => {
    await sendCommand("CMD_POWER\n");
  });
  elements.buzzerToggle.addEventListener("click", async () => {
    state.buzzerEnabled = !state.buzzerEnabled;
    await sendCommand(formatCommand("CMD_BUZZER", state.buzzerEnabled ? 1 : 0));
  });
};

const setupConnectionControls = () => {
  elements.connectBtn.addEventListener("click", async () => {
    const ip = elements.ipInput.value.trim();
    if (!ip) {
      alert("Enter robot IP");
      return;
    }
    try {
      await postJson("/api/connect", { ip });
      updateConnectionStatus(true, ip);
    } catch (error) {
      alert(`Connect failed: ${error.message}`);
    }
  });

  elements.disconnectBtn.addEventListener("click", async () => {
    await postJson("/api/disconnect", {});
    updateConnectionStatus(false, "");
  });
};

const setupRawCommand = () => {
  elements.sendRaw.addEventListener("click", async () => {
    const value = elements.rawCommand.value;
    if (!value) {
      return;
    }
    await sendCommand(value);
  });
};

setupConnectionControls();
setupMovementButtons();
setupLEDButtons();
setupDriveModeButtons();
setupServoControls();
setupToggles();
setupRawCommand();

setInterval(pollState, 1500);
setInterval(updateVideo, 1000);
