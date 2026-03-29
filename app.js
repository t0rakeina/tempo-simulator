const needleEl = document.getElementById("needle");
const currentAngleEl = document.getElementById("currentAngle");
const startAngleEl = document.getElementById("startAngle");
const stepInfoEl = document.getElementById("stepInfo");
const statusTextEl = document.getElementById("statusText");
const scoreInputEl = document.getElementById("scoreInput");
const messageBoxEl = document.getElementById("messageBox");
const manualAngleEl = document.getElementById("manualAngle");

const applyManualAngleBtn = document.getElementById("applyManualAngleBtn");
const setStartBtn = document.getElementById("setStartBtn");
const sampleBtn = document.getElementById("sampleBtn");
const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");

let currentAngle = 0;
let startAngle = 0;
let parsedCommands = [];
let currentStepIndex = -1;
let isPlaying = false;
let stopRequested = false;
let animationFrameId = null;

function setMessage(text) {
  messageBoxEl.textContent = text;
}

function setStatus(text) {
  statusTextEl.textContent = text;
}

function updateNeedle(angle) {
  currentAngle = angle;
  needleEl.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
  currentAngleEl.textContent = `${roundToOne(angle)}°`;
}

function updateStartAngleDisplay() {
  startAngleEl.textContent = `${roundToOne(startAngle)}°`;
}

function updateStepInfo() {
  if (currentStepIndex < 0 || parsedCommands.length === 0) {
    stepInfoEl.textContent = "-";
    return;
  }
  stepInfoEl.textContent = `${currentStepIndex + 1} / ${parsedCommands.length}`;
}

function roundToOne(num) {
  return Math.round(num * 10) / 10;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseScore(text) {
  const lines = text.split("\n");
  const commands = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split(/\s+/);
    const command = parts[0].toUpperCase();

    if (command === "MOVE") {
      if (parts.length !== 3) {
        throw new Error(`Line ${i + 1}: MOVE requires angle and duration.`);
      }

      const angle = Number(parts[1]);
      const duration = Number(parts[2]);

      if (Number.isNaN(angle)) {
        throw new Error(`Line ${i + 1}: angle must be a number.`);
      }
      if (Number.isNaN(duration) || duration < 0) {
        throw new Error(`Line ${i + 1}: duration must be a non-negative number.`);
      }

      commands.push({
        type: "MOVE",
        angle,
        duration,
        lineNumber: i + 1,
      });
    } else if (command === "HOLD") {
      if (parts.length !== 2) {
        throw new Error(`Line ${i + 1}: HOLD requires duration.`);
      }

      const duration = Number(parts[1]);

      if (Number.isNaN(duration) || duration < 0) {
        throw new Error(`Line ${i + 1}: duration must be a non-negative number.`);
      }

      commands.push({
        type: "HOLD",
        duration,
        lineNumber: i + 1,
      });
    } else {
      throw new Error(`Line ${i + 1}: Unknown command "${parts[0]}".`);
    }
  }

  return commands;
}

function cancelAnimationIfNeeded() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function animateMove(deltaAngle, duration) {
  return new Promise((resolve) => {
    const from = currentAngle;
    const to = from + deltaAngle;

    if (duration === 0) {
      updateNeedle(to);
      resolve();
      return;
    }

    const startTime = performance.now();

    function frame(now) {
      if (stopRequested) {
        resolve();
        return;
      }

      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const nextAngle = from + (to - from) * progress;

      updateNeedle(nextAngle);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(frame);
      } else {
        animationFrameId = null;
        resolve();
      }
    }

    animationFrameId = requestAnimationFrame(frame);
  });
}

async function runCommands() {
  stopRequested = false;
  isPlaying = true;
  setStatus("Playing");

  for (let i = 0; i < parsedCommands.length; i++) {
    if (stopRequested) {
      break;
    }

    currentStepIndex = i;
    updateStepInfo();

    const cmd = parsedCommands[i];

    if (cmd.type === "MOVE") {
      setMessage(`Line ${cmd.lineNumber}: MOVE ${cmd.angle} ${cmd.duration}`);
      await animateMove(cmd.angle, cmd.duration);
    } else if (cmd.type === "HOLD") {
      setMessage(`Line ${cmd.lineNumber}: HOLD ${cmd.duration}`);
      await sleep(cmd.duration);
    }
  }

  isPlaying = false;
  stopRequested = false;
  cancelAnimationIfNeeded();

  if (currentStepIndex >= parsedCommands.length - 1 && parsedCommands.length > 0) {
    setStatus("Finished");
    setMessage("Playback finished.");
  } else {
    setStatus("Stopped");
    setMessage("Playback stopped.");
  }
}

function resetToStartAngle() {
  stopRequested = true;
  cancelAnimationIfNeeded();
  isPlaying = false;
  currentStepIndex = -1;
  updateNeedle(startAngle);
  updateStepInfo();
  setStatus("Idle");
  setMessage("Reset to start angle.");
}

applyManualAngleBtn.addEventListener("click", () => {
  const angle = Number(manualAngleEl.value);

  if (Number.isNaN(angle)) {
    setMessage("Manual angle must be a number.");
    return;
  }

  updateNeedle(angle);
  setStatus("Manual Set");
  setMessage(`Current angle set to ${angle}°`);
});

setStartBtn.addEventListener("click", () => {
  startAngle = currentAngle;
  updateStartAngleDisplay();
  setStatus("Start Set");
  setMessage(`Start angle saved as ${roundToOne(startAngle)}°`);
});

sampleBtn.addEventListener("click", () => {
  scoreInputEl.value = `# Sample score
MOVE 90 1200
HOLD 300
MOVE -45 800
HOLD 300
MOVE 180 1500`;
  setMessage("Sample loaded.");
});

playBtn.addEventListener("click", async () => {
  if (isPlaying) {
    setMessage("Already playing.");
    return;
  }

  try {
    parsedCommands = parseScore(scoreInputEl.value);

    if (parsedCommands.length === 0) {
      setMessage("No commands found.");
      return;
    }

    currentStepIndex = -1;
    updateStepInfo();
    setMessage("Parsed successfully.");

    await runCommands();
  } catch (error) {
    setStatus("Error");
    setMessage(error.message);
  }
});

stopBtn.addEventListener("click", () => {
  if (!isPlaying) {
    setMessage("Not currently playing.");
    return;
  }

  stopRequested = true;
  cancelAnimationIfNeeded();
  isPlaying = false;
  setStatus("Stopped");
  setMessage("Stop requested.");
});

resetBtn.addEventListener("click", () => {
  resetToStartAngle();
});

clearBtn.addEventListener("click", () => {
  scoreInputEl.value = "";
  setMessage("Score cleared.");
});

function initialize() {
  updateNeedle(0);
  updateStartAngleDisplay();
  updateStepInfo();
  setStatus("Idle");
  setMessage("Ready.");
}

initialize();