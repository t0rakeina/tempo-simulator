const needleEl = document.getElementById("needle");
const currentAngleEl = document.getElementById("currentAngle");
const startAngleEl = document.getElementById("startAngle");
const stepInfoEl = document.getElementById("stepInfo");
const statusTextEl = document.getElementById("statusText");
const scoreInputEl = document.getElementById("scoreInput");
const messageBoxEl = document.getElementById("messageBox");
const manualAngleEl = document.getElementById("manualAngle");
const lineNumbersEl = document.getElementById("lineNumbers");
const activeLineHighlightEl = document.getElementById("activeLineHighlight");

const applyManualAngleBtn = document.getElementById("applyManualAngleBtn");
const setStartBtn = document.getElementById("setStartBtn");
const sampleBtn = document.getElementById("sampleBtn");
const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const clearBtn = document.getElementById("clearBtn");

// 実機相当（フルステップ）
const STEPS_PER_REV = 200;
const DEG_PER_STEP = 360 / STEPS_PER_REV; // 1.8°

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

function roundToOne(num) {
  return Math.round(num * 10) / 10;
}

function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function degToSteps(deg) {
  const stepsF = deg / DEG_PER_STEP;
  return stepsF >= 0 ? Math.round(stepsF) : -Math.round(Math.abs(stepsF));
}

function stepsToDeg(steps) {
  return steps * DEG_PER_STEP;
}

function updateNeedle(angle) {
  currentAngle = angle;
  needleEl.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
  currentAngleEl.textContent = `${roundToOne(normalizeAngle(angle))}°`;
}

function updateStartAngleDisplay() {
  startAngleEl.textContent = `${roundToOne(normalizeAngle(startAngle))}°`;
}

function updateStepInfo() {
  if (currentStepIndex < 0 || parsedCommands.length === 0) {
    stepInfoEl.textContent = "-";
    return;
  }
  stepInfoEl.textContent = `${currentStepIndex + 1} / ${parsedCommands.length}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cancelAnimationIfNeeded() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function stripLineComment(line) {
  const commentIndex = line.indexOf("//");
  if (commentIndex >= 0) {
    return line.slice(0, commentIndex);
  }
  return line;
}

function parseScore(text) {
  const lines = text.split("\n");
  const commands = [];

  const rowPattern =
    /^\s*\{\s*([+-]?\d+(?:\.\d+)?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}\s*,?\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const originalLine = lines[i];
    const withoutComment = stripLineComment(originalLine);
    const line = withoutComment.trim();

    if (!line) continue;

    const match = line.match(rowPattern);
    if (!match) continue;

    const moveDeg = Number(match[1]);
    const moveMs = Number(match[2]);
    const holdMs = Number(match[3]);

    if (
      Number.isNaN(moveDeg) ||
      Number.isNaN(moveMs) ||
      Number.isNaN(holdMs)
    ) {
      throw new Error(`Line ${i + 1}: invalid numeric values.`);
    }

    if (moveMs < 0 || holdMs < 0) {
      throw new Error(`Line ${i + 1}: moveMs and holdMs must be >= 0.`);
    }

    commands.push({
      moveDeg,
      moveMs,
      holdMs,
      lineNumber: i + 1,
      raw: line,
    });
  }

  if (commands.length === 0) {
    throw new Error(
      "No ScoreRow lines found. Expected lines like: { 30, 150, 0 },"
    );
  }

  return commands;
}

function animateMoveTo(targetAngle, duration) {
  return new Promise((resolve) => {
    const from = currentAngle;
    const to = targetAngle;

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

function updateLineNumbers() {
  const text = scoreInputEl.value;
  const lineCount = Math.max(1, text.split("\n").length);
  const numbers = [];

  for (let i = 1; i <= lineCount; i++) {
    numbers.push(String(i));
  }

  lineNumbersEl.textContent = numbers.join("\n");
  lineNumbersEl.scrollTop = scoreInputEl.scrollTop;
}

function hideActiveLineHighlight() {
  activeLineHighlightEl.classList.add("hidden");
}

function showActiveLineHighlight(lineNumber) {
  const lineHeight = 21;
  const topPadding = 16;
  const top = topPadding + (lineNumber - 1) * lineHeight - scoreInputEl.scrollTop;

  activeLineHighlightEl.style.top = `${top}px`;
  activeLineHighlightEl.classList.remove("hidden");
}

async function runCommands() {
  stopRequested = false;
  isPlaying = true;
  setStatus("Playing");

  // 実機相当：累積角度 → ステップ丸め → 実角度
  let currentTargetDeg = 0;
  let currentStep = 0;

  for (let i = 0; i < parsedCommands.length; i++) {
    if (stopRequested) break;

    currentStepIndex = i;
    updateStepInfo();

    const cmd = parsedCommands[i];
    showActiveLineHighlight(cmd.lineNumber);

    currentTargetDeg += cmd.moveDeg;

    const targetStep = degToSteps(currentTargetDeg);
    const deltaStep = targetStep - currentStep;
    const actualTargetAngle = startAngle + stepsToDeg(targetStep);

    setMessage(
      [
        `Line ${cmd.lineNumber}`,
        `input: moveDeg=${cmd.moveDeg}°, moveMs=${cmd.moveMs}, holdMs=${cmd.holdMs}`,
        `rounded: targetStep=${targetStep}, deltaStep=${deltaStep}, actualTarget=${roundToOne(normalizeAngle(actualTargetAngle))}°`
      ].join("\n")
    );

    await animateMoveTo(actualTargetAngle, cmd.moveMs);
    currentStep = targetStep;

    if (stopRequested) break;

    if (cmd.holdMs > 0) {
      await sleep(cmd.holdMs);
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

  hideActiveLineHighlight();
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
  hideActiveLineHighlight();
}

applyManualAngleBtn.addEventListener("click", () => {
  const angle = Number(manualAngleEl.value);

  if (Number.isNaN(angle)) {
    setMessage("Manual angle must be a number.");
    return;
  }

  updateNeedle(angle);
  setStatus("Manual Set");
  setMessage(`Current angle set to ${roundToOne(angle)}°`);
});

setStartBtn.addEventListener("click", () => {
  startAngle = currentAngle;
  updateStartAngleDisplay();
  setStatus("Start Set");
  setMessage(`Start angle saved as ${roundToOne(normalizeAngle(startAngle))}°`);
});

sampleBtn.addEventListener("click", () => {
  scoreInputEl.value = `{ 15, 150, 0 },
{ -30, 150, 0 },
{ 30, 150, 0 },
{ -30, 150, 0 },
{ 30, 150, 0 },
{ -30, 150, 0 },
{ 30, 150, 0 },
{ -30, 150, 0 },
{ 15, 150, 0 },
{ 0, 0, 850 },
{ 30, 50, 200 }`;
  updateLineNumbers();
  setMessage("Sample loaded.");
  hideActiveLineHighlight();
});

playBtn.addEventListener("click", async () => {
  if (isPlaying) {
    setMessage("Already playing.");
    return;
  }

  try {
    parsedCommands = parseScore(scoreInputEl.value);
    currentStepIndex = -1;
    updateStepInfo();
    setMessage("Parsed successfully.");
    await runCommands();
  } catch (error) {
    setStatus("Error");
    setMessage(error.message);
    hideActiveLineHighlight();
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
  hideActiveLineHighlight();
});

resetBtn.addEventListener("click", () => {
  resetToStartAngle();
});

clearBtn.addEventListener("click", () => {
  scoreInputEl.value = "";
  updateLineNumbers();
  setMessage("Score cleared.");
  hideActiveLineHighlight();
});

scoreInputEl.addEventListener("input", () => {
  updateLineNumbers();
  hideActiveLineHighlight();
  currentStepIndex = -1;
  updateStepInfo();
});

scoreInputEl.addEventListener("scroll", () => {
  lineNumbersEl.scrollTop = scoreInputEl.scrollTop;

  if (
    currentStepIndex >= 0 &&
    parsedCommands[currentStepIndex] &&
    !activeLineHighlightEl.classList.contains("hidden")
  ) {
    showActiveLineHighlight(parsedCommands[currentStepIndex].lineNumber);
  }
});

function initialize() {
  updateNeedle(0);
  updateStartAngleDisplay();
  updateStepInfo();
  setStatus("Idle");
  setMessage("Ready.");
  updateLineNumbers();
  hideActiveLineHighlight();
}

initialize();
