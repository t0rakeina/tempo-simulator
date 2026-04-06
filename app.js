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

// ------------------------------------------------------------
// 安全ガード
// ------------------------------------------------------------

function signOfMove(moveDeg) {
  if (moveDeg > 0) return 1;
  if (moveDeg < 0) return -1;
  return 0;
}

function analyzeSafety(commands) {
  const cautions = [];
  const warnings = [];

  // 反転ブロック解析
  let blockMoves = [];
  let prevSign = 0;

  function flushBlock() {
    if (blockMoves.length < 2) {
      blockMoves = [];
      return;
    }

    const reversalCount = blockMoves.length - 1;
    const maxAbsDeg = Math.max(...blockMoves.map((m) => Math.abs(m.moveDeg)));
    const minMoveMs = Math.min(...blockMoves.map((m) => m.moveMs));
    const zeroHoldCount = blockMoves.filter((m) => m.holdMs === 0).length;

    // ルール1：小刻み反転
    if (maxAbsDeg <= 30 && minMoveMs <= 120 && reversalCount >= 4) {
      warnings.push(
        `小〜中振れ幅（≤30°）の高速反転が ${reversalCount} 回連続しています`
      );
    } else if (maxAbsDeg <= 30 && minMoveMs <= 200 && reversalCount >= 3) {
      cautions.push(
        `小〜中振れ幅（≤30°）の反転が ${reversalCount} 回連続しています`
      );
    }

    // ルール2：中振れ幅の高速反転
    if (maxAbsDeg > 30 && maxAbsDeg <= 60 && minMoveMs <= 100 && reversalCount >= 3) {
      warnings.push(
        `中振れ幅（30〜60°）の高速反転が ${reversalCount} 回連続しています`
      );
    } else if (maxAbsDeg > 30 && maxAbsDeg <= 60 && minMoveMs <= 150 && reversalCount >= 2) {
      cautions.push(
        `中振れ幅（30〜60°）の反転が ${reversalCount} 回連続しています`
      );
    }

    // ルール5：停止なし連続
    if (zeroHoldCount >= 10 && reversalCount >= 4) {
      warnings.push(`停止なし（holdMs=0）の反転が長く続いています`);
    } else if (zeroHoldCount >= 6 && reversalCount >= 3) {
      cautions.push(`停止なし（holdMs=0）の反転が続いています`);
    }

    blockMoves = [];
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const sign = signOfMove(cmd.moveDeg);

    if (sign === 0) {
      flushBlock();
      prevSign = 0;
      continue;
    }

    if (prevSign === 0) {
      blockMoves = [cmd];
      prevSign = sign;
      continue;
    }

    if (sign !== prevSign) {
      blockMoves.push(cmd);
      prevSign = sign;
    } else {
      flushBlock();
      blockMoves = [cmd];
      prevSign = sign;
    }
  }
  flushBlock();

  // ルール3：大振れ幅の高速移動
  commands.forEach((cmd) => {
    const absDeg = Math.abs(cmd.moveDeg);

    if (absDeg >= 120 && cmd.moveMs <= 100) {
      warnings.push(`大振れ幅（≥120°）を短時間（≤100ms）で動かしています`);
    } else if (absDeg >= 90 && cmd.moveMs <= 150) {
      cautions.push(`大振れ幅（≥90°）を短時間（≤150ms）で動かしています`);
    }
  });

  // ルール4：月送り直前の激しい往復
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    // 月送りっぽい大きめの移動を仮に20°以上とみなす
    if (Math.abs(cmd.moveDeg) < 20) continue;

    const prevSlice = commands.slice(Math.max(0, i - 8), i);

    let reversalCount = 0;
    for (let j = 1; j < prevSlice.length; j++) {
      const a = signOfMove(prevSlice[j - 1].moveDeg);
      const b = signOfMove(prevSlice[j].moveDeg);
      if (a !== 0 && b !== 0 && a !== b) reversalCount++;
    }

    const fastCount = prevSlice.filter((x) => x.moveMs <= 120).length;

    if (reversalCount >= 4 && fastCount >= 4 && cmd.moveMs <= 100) {
      warnings.push(`激しい往復の直後に速い月移動が入っています`);
    } else if (reversalCount >= 3 && fastCount >= 3) {
      cautions.push(`往復の直後に月移動が入っています`);
    }
  }

  // 重複を整理
  const uniqueCautions = [...new Set(cautions)];
  const uniqueWarnings = [...new Set(warnings)];

  let level = "Safe";
  if (uniqueWarnings.length > 0) {
    level = "Warning";
  } else if (uniqueCautions.length > 0) {
    level = "Caution";
  }

  return {
    level,
    cautions: uniqueCautions,
    warnings: uniqueWarnings,
  };
}

function formatSafetyReport(result) {
  const lines = [];
  lines.push(`Safety Check: ${result.level}`);

  if (result.level === "Safe") {
    lines.push("実機でも比較的安定して再生できる可能性が高いです。");
    return lines.join("\n");
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("[Warning]");
    result.warnings.forEach((w) => lines.push(`- ${w}`));
  }

  if (result.cautions.length > 0) {
    lines.push("");
    lines.push("[Caution]");
    result.cautions.forEach((c) => lines.push(`- ${c}`));
  }

  lines.push("");
  if (result.level === "Warning") {
    lines.push("本番針ではズレや接触が起こる可能性があります。");
    lines.push("ゆるめの設定でもう一度確認してください。");
  } else if (result.level === "Caution") {
    lines.push("本番針では負荷が高くなる可能性があります。");
    lines.push("実機で確認しながら調整してください。");
  }

  return lines.join("\n");
}

// ------------------------------------------------------------

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

    const safety = analyzeSafety(parsedCommands);
    const safetyReport = formatSafetyReport(safety);

    currentStepIndex = -1;
    updateStepInfo();
    setStatus(safety.level);

    // 再生前にまず安全判定を表示
    setMessage(safetyReport);

    // 少し見える時間を置いてから再生
    await sleep(600);

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
