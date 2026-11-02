// ============================================================================
// openOii Landing Page — Editorial Blueprint Interactive Controller
// ============================================================================

(() => {
  const htmlEl = document.documentElement;
  const themeBtn = document.getElementById("theme-toggle-btn");
  const themeLabel = document.getElementById("theme-toggle-label");
  const metaThemeColor = document.getElementById("meta-theme-color");

  const SCREENSHOT_MAP = {
    workbench: {
      light: "./assets/screenshots/workbench.webp",
      dark: "./assets/screenshots/workbench-dark.webp",
    },
    home: {
      light: "./assets/screenshots/home.webp",
      dark: "./assets/screenshots/home-dark.webp",
    },
    projects: {
      light: "./assets/screenshots/projects.webp",
      dark: "./assets/screenshots/projects.webp",
    },
    "settings-video-presets": {
      light: "./assets/screenshots/settings-video-presets.webp",
      dark: "./assets/screenshots/settings-video-presets.webp",
    },
  };

  function applyTheme(theme) {
    htmlEl.setAttribute("data-theme", theme);
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", theme === "dark" ? "#0B0C10" : "#F5F3EE");
    }
    if (themeLabel) {
      themeLabel.textContent = theme === "dark" ? "浅色外观" : "深色外观";
    }
    document.querySelectorAll("[data-theme-img]").forEach((img) => {
      const key = img.getAttribute("data-theme-img");
      const entry = SCREENSHOT_MAP[key];
      if (entry && entry[theme]) {
        img.setAttribute("src", entry[theme]);
      }
    });
    try {
      localStorage.setItem("openoii-theme", theme);
    } catch (_) {}
  }

  let savedTheme = "light";
  try {
    const stored = localStorage.getItem("openoii-theme");
    if (stored === "dark" || stored === "light") savedTheme = stored;
  } catch (_) {}
  applyTheme(savedTheme);

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = htmlEl.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

  // 2. Interactive Director's Storyboard Desk (S01–S06 + Live Inspector)
  const SHOT_IDS = ["S01", "S02", "S03", "S04", "S05", "S06"];
  const INITIAL_SHOTS = {
    S01: {
      title: "炎夏寻水 · 发现半瓶水",
      img: "./assets/shots/s01.webp",
      score: "8.5 达标",
      pass: true,
      prompt: "炎炎夏日干裂土地上，口渴的小乌鸦落在半瓶清水旁，水彩构图与角色造型达标",
    },
    S02: {
      title: "瓶颈受阻 · 够不着水面",
      img: "./assets/shots/s02.webp",
      score: "6.5 待微调",
      pass: false,
      prompt: "质量审查提示：嘴未伸入瓶口且缺少够不着水的失落感，建议调整小乌鸦嘴部位置与神态后重新生成",
    },
    S03: {
      title: "灵光一现 · 目光锁定石子",
      img: "./assets/shots/s03.webp",
      score: "8.8 达标",
      pass: true,
      prompt: "小乌鸦灵机一动，目光锁定陶瓶旁散落的小石子，画面焦点与神态自然",
    },
    S04: {
      title: "衔石入瓶 · 石子落水",
      img: "./assets/shots/s04.webp",
      score: "8.6 达标",
      pass: true,
      prompt: "小乌鸦衔起第一颗石子投入细瓶口，水面泛起微澜，动作衔接顺畅",
    },
    S05: {
      title: "锲而不舍 · 水位稳步上升",
      img: "./assets/shots/s05.webp",
      score: "8.7 达标",
      pass: true,
      prompt: "瓶底石子越积越多，瓶中清水随之稳步抬升，水彩笔触保持一致",
    },
    S06: {
      title: "畅饮甘泉 · 智慧解渴",
      img: "./assets/shots/s06.webp",
      score: "9.2 达标",
      pass: true,
      prompt: "清水终于升至瓶口，小乌鸦低头畅饮甘泉，圆满收尾",
    },
  };

  let shotState = JSON.parse(JSON.stringify(INITIAL_SHOTS));
  let activeShotId = "S02";

  const inspId = document.getElementById("inspector-shot-id");
  const inspBadge = document.getElementById("inspector-shot-badge");
  const inspPreviewBox = document.getElementById("inspector-preview-box");
  const inspImg = document.getElementById("inspector-shot-img");
  const inspTitle = document.getElementById("inspector-shot-title");
  const inspPrompt = document.getElementById("inspector-shot-prompt");
  const dockApproveBtn = document.getElementById("dock-approve-btn");
  const dockResetBtn = document.getElementById("dock-reset-btn");

  function renderStoryboard() {
    const cur = shotState[activeShotId];
    if (!cur) return;

    document.querySelectorAll("[data-shot-id]").forEach((btn) => {
      const id = btn.getAttribute("data-shot-id");
      const info = shotState[id];
      btn.setAttribute("aria-pressed", id === activeShotId ? "true" : "false");
      const badge = btn.querySelector("[data-shot-badge]");
      if (badge && info) {
        badge.textContent = info.score;
        badge.className =
          "shot-badge " + (info.pass ? "shot-badge--pass" : "shot-badge--warn");
      }
    });

    if (inspId) inspId.textContent = `DIRECTOR INSPECTOR · ${activeShotId}`;
    if (inspBadge) {
      inspBadge.textContent = cur.score;
      inspBadge.className =
        "shot-badge " + (cur.pass ? "shot-badge--pass" : "shot-badge--warn");
    }
    if (inspImg) inspImg.setAttribute("src", cur.img);
    if (inspTitle) inspTitle.textContent = cur.title;
    if (inspPrompt) inspPrompt.textContent = cur.prompt;
    if (dockApproveBtn) {
      dockApproveBtn.textContent = cur.pass
        ? `已确认 ${activeShotId} ✓`
        : `确认重绘 ${activeShotId}`;
    }
  }

  document.querySelectorAll("[data-shot-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-shot-id");
      if (id && shotState[id]) {
        activeShotId = id;
        renderStoryboard();
      }
    });

    btn.addEventListener("keydown", (e) => {
      const idx = SHOT_IDS.indexOf(activeShotId);
      if (idx === -1) return;
      let nextIdx = -1;
      if (e.key === "ArrowRight") nextIdx = (idx + 1) % SHOT_IDS.length;
      if (e.key === "ArrowLeft") nextIdx = (idx - 1 + SHOT_IDS.length) % SHOT_IDS.length;
      if (nextIdx !== -1) {
        e.preventDefault();
        activeShotId = SHOT_IDS[nextIdx];
        renderStoryboard();
        const nextBtn = document.querySelector(`[data-shot-id="${activeShotId}"]`);
        if (nextBtn) nextBtn.focus();
      }
    });
  });

  if (dockApproveBtn) {
    dockApproveBtn.addEventListener("click", () => {
      const cur = shotState[activeShotId];
      if (!cur) return;
      if (inspPreviewBox) inspPreviewBox.classList.add("is-redrawing");
      setTimeout(() => {
        cur.pass = true;
        cur.score = activeShotId === "S02" ? "9.1 已重绘" : "9.3 已重绘";
        cur.prompt = `${activeShotId} 已按修改意见完成局部重绘并通过质量复检，其余 5 个已完成镜头保持不变`;
        renderStoryboard();
        if (inspPreviewBox) inspPreviewBox.classList.remove("is-redrawing");
      }, 160);
    });
  }

  if (dockResetBtn) {
    dockResetBtn.addEventListener("click", () => {
      shotState = JSON.parse(JSON.stringify(INITIAL_SHOTS));
      activeShotId = "S02";
      renderStoryboard();
    });
  }

  // 3. Oversized Typographic Index Switcher (01–04)
  const ACT_KEYS = ["home", "workbench", "projects", "settings-video-presets"];
  const workflowStageImg = document.getElementById("workflow-stage-img");

  document.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-act"));
      const imgKey = ACT_KEYS[idx];
      if (!imgKey) return;
      document.querySelectorAll("[data-act]").forEach((b) => {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      if (workflowStageImg) {
        workflowStageImg.classList.add("is-switching");
        workflowStageImg.setAttribute("data-theme-img", imgKey);
        const theme = htmlEl.getAttribute("data-theme") || "light";
        const entry = SCREENSHOT_MAP[imgKey];
        if (entry && entry[theme]) {
          workflowStageImg.setAttribute("src", entry[theme]);
        }
        setTimeout(() => {
          workflowStageImg.classList.remove("is-switching");
        }, 120);
      }
    });
  });

  // 4. Copy Docker Command
  const copyBtn = document.getElementById("copy-cmd-btn");
  const cmdEl = document.getElementById("quickstart-cmd");
  if (copyBtn && cmdEl) {
    copyBtn.addEventListener("click", async () => {
      const text = cmdEl.textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {}
      copyBtn.textContent = "已复制 ✓";
      setTimeout(() => {
        copyBtn.textContent = "复制命令";
      }, 1800);
    });
  }

  // 5. Idle Preload Secondary Stage Images for Zero-Lag Switching
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1200));
  idle(() => {
    [
      "./assets/screenshots/projects.webp",
      "./assets/screenshots/settings-video-presets.webp",
      "./assets/screenshots/workbench-dark.webp",
      "./assets/screenshots/home-dark.webp",
    ].forEach((url) => {
      const img = new Image();
      img.src = url;
    });
  });
})();
