(() => {
  const SHOTS = {
    s01: {
      id: "S01",
      title: "阁楼全景 · 雨夜停摆",
      duration: "5s",
      locked: true,
      camera: "全景固定机位",
      cast: ["阿哲", "银白小猫"],
      removedCast: [],
      dialogue: "旁白：「雨夜里，时间停了很久」",
      v2Img: "./assets/shots/r01.webp",
      v2Label: "当前画面",
      note: "已通过审批门锁定，重拍其他镜头时保持不动。",
    },
    s02: {
      id: "S02",
      title: "近景俯身 · 镊子试探机芯",
      duration: "5s",
      locked: true,
      camera: "近景俯拍 · 桌面浅景深",
      cast: ["阿哲", "银白小猫"],
      removedCast: [],
      dialogue: "旁白：「他一次次，细细检修着」",
      v2Img: "./assets/shots/r02.webp",
      v2Label: "当前画面",
      note: "复用阿哲与银白小猫定妆立绘，跨镜保持衣纹与色温一致。",
    },
    s03: {
      id: "S03",
      title: "放大镜微距 · 铜齿轮咬合（定向重拍）",
      duration: "4s",
      locked: false,
      hasDiff: true,
      camera: "微距特写 · 黄铜放大镜构图",
      cast: ["阿哲"],
      removedCast: ["银白小猫"],
      dialogue: "旁白：「最后一处，轻轻咬合」",
      v1Img: "./assets/shots/r03-v1.webp",
      v1Label: "重拍前（小猫误入穿帮）",
      v2Img: "./assets/shots/r03-v2.webp",
      v2Label: "重拍后（解绑小猫 + 琥珀光束）",
      note: "移出「银白小猫」出场绑定并补充暖琥珀台灯光束批注后，仅重绘 S03。",
    },
    s04: {
      id: "S04",
      title: "怀表复苏 · 掌心齿轮轻转",
      duration: "5s",
      locked: true,
      camera: "近景正面",
      cast: ["阿哲"],
      removedCast: [],
      dialogue: "旁白：「滴答声，终于回来了」",
      v2Img: "./assets/shots/r04.webp",
      v2Label: "当前画面",
      note: "已锁定保护，视频切片与配音音轨直接保留。",
    },
    s05: {
      id: "S05",
      title: "终幕定格 · 一人一猫凝望时光",
      duration: "5s",
      locked: true,
      camera: "中景拉远",
      cast: ["阿哲", "银白小猫"],
      removedCast: [],
      dialogue: "旁白：「时间，又缓缓流动起来」",
      v2Img: "./assets/shots/r05.webp",
      v2Label: "当前画面",
      note: "已锁定并就绪，可直出 MP4 或导出时间线资产包。",
    },
  };

  const DEPLOY_SNIPPETS = {
    docker: `git clone https://github.com/xeronsh/KomaSlate.git
cd KomaSlate
cp backend/.env.example backend/.env
docker compose up -d
# 浏览器打开 http://localhost:3000 （API 网关 :18765）`,
    local: `# 后端启动后首次生成会自动拉起同库 Engine Sidecar (:18766)
cd backend && uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18765

# 新开终端启动画布前端 (:15173)
cd frontend && pnpm install && pnpm dev`,
  };

  // --- Theme toggle & theme-reactive screenshots ---
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme-toggle");
  const themeLabel = document.getElementById("theme-toggle-label");

  function syncThemeImages(theme) {
    document.querySelectorAll("img[data-light-src][data-dark-src]").forEach((img) => {
      const target = theme === "dark" ? img.dataset.darkSrc : img.dataset.lightSrc;
      if (target && img.getAttribute("src") !== target) {
        img.setAttribute("src", target);
      }
    });
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    try {
      localStorage.setItem("komaslate-site-theme", theme);
    } catch (_) {}
    if (themeLabel) {
      themeLabel.textContent = theme === "dark" ? "浅色" : "深色";
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", theme === "dark" ? "#0f1018" : "#f7f5f0");
    }
    syncThemeImages(theme);
  }

  const savedTheme = (() => {
    try {
      return localStorage.getItem("komaslate-site-theme");
    } catch (_) {
      return null;
    }
  })();
  const initialTheme = savedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(initialTheme);

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
  }

  // --- Interactive #1: Contact Sheet & Take v1/v2 Inspector ---
  let activeShotKey = "s03";
  let activeTakeMode = "split"; // "split" | "v2" | "v1"

  const shotButtons = document.querySelectorAll("[data-shot-key]");
  const takeButtons = document.querySelectorAll("[data-take-mode]");
  const takeTabsWrap = document.getElementById("take-tabs");
  const compareContainer = document.getElementById("compare-container");
  const inspShotId = document.getElementById("insp-shot-id");
  const inspStatus = document.getElementById("insp-status");
  const inspTitle = document.getElementById("insp-title");
  const inspCamera = document.getElementById("insp-camera");
  const inspCast = document.getElementById("insp-cast");
  const inspNote = document.getElementById("insp-note");
  const inspDialogue = document.getElementById("insp-dialogue");

  function renderInspector() {
    const shot = SHOTS[activeShotKey];
    if (!shot || !compareContainer) return;

    shotButtons.forEach((btn) => {
      const selected = btn.dataset.shotKey === activeShotKey;
      btn.classList.toggle("is-active", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });

    if (inspShotId) inspShotId.textContent = `${shot.id} · ${shot.duration}`;
    if (inspStatus) {
      inspStatus.textContent = shot.locked ? "已锁定" : "已重拍";
      inspStatus.className = "micro-pill " + (shot.locked ? "success" : "primary");
    }
    if (inspTitle) inspTitle.textContent = shot.title;
    if (inspCamera) inspCamera.textContent = shot.camera;
    if (inspNote) inspNote.textContent = shot.note;
    if (inspDialogue) inspDialogue.textContent = shot.dialogue;

    if (inspCast) {
      inspCast.innerHTML = "";
      shot.cast.forEach((name) => {
        const span = document.createElement("span");
        span.className = "cast-pill";
        span.textContent = name;
        inspCast.appendChild(span);
      });
      (shot.removedCast || []).forEach((name) => {
        const span = document.createElement("span");
        span.className = "cast-pill muted";
        span.title = "已在重拍前移出本镜出场角色";
        span.textContent = name + "（已解绑）";
        inspCast.appendChild(span);
      });
    }

    if (takeTabsWrap) {
      takeTabsWrap.hidden = !shot.hasDiff;
    }

    takeButtons.forEach((btn) => {
      const active = btn.dataset.takeMode === activeTakeMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    compareContainer.innerHTML = "";
    if (shot.hasDiff && activeTakeMode === "split") {
      compareContainer.className = "compare-split";
      compareContainer.innerHTML = `
        <figure class="take-frame" style="margin:0">
          <img src="${shot.v1Img}" alt="${shot.id} 重拍前" loading="eager" decoding="async">
          <figcaption class="take-caption">
            <span>重拍前</span>
            <span class="take-badge warn">穿帮</span>
          </figcaption>
        </figure>
        <figure class="take-frame highlight" style="margin:0">
          <img src="${shot.v2Img}" alt="${shot.id} 重拍后" loading="eager" decoding="async">
          <figcaption class="take-caption">
            <span>重拍后</span>
            <span class="take-badge good">当前采用</span>
          </figcaption>
        </figure>
      `;
    } else {
      compareContainer.className = "compare-split single-mode";
      const showV1 = shot.hasDiff && activeTakeMode === "v1";
      const src = showV1 ? shot.v1Img : shot.v2Img;
      const label = showV1 ? shot.v1Label : shot.v2Label;
      const badgeCls = showV1 ? "warn" : "good";
      const badgeTxt = showV1 ? "历史版本" : shot.locked ? "已锁定" : "当前采用";
      compareContainer.innerHTML = `
        <figure class="take-frame highlight" style="margin:0">
          <img src="${src}" alt="${shot.id}" loading="eager" decoding="async">
          <figcaption class="take-caption">
            <span>${label}</span>
            <span class="take-badge ${badgeCls}">${badgeTxt}</span>
          </figcaption>
        </figure>
      `;
    }
  }

  shotButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeShotKey = btn.dataset.shotKey || "s03";
      if (SHOTS[activeShotKey]?.hasDiff) {
        activeTakeMode = "split";
      }
      renderInspector();
    });
  });

  takeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTakeMode = btn.dataset.takeMode || "split";
      renderInspector();
    });
  });

  renderInspector();

  // --- Interactive #2: FCPXML Track View vs XML Source ---
  const nleTabs = document.querySelectorAll("[data-nle-view]");
  const nleTracksPane = document.getElementById("nle-tracks-pane");
  const nleXmlPane = document.getElementById("nle-xml-pane");

  nleTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.nleView;
      nleTabs.forEach((b) => {
        const isAct = b === btn;
        b.classList.toggle("is-active", isAct);
        b.setAttribute("aria-selected", String(isAct));
      });
      if (nleTracksPane && nleXmlPane) {
        nleTracksPane.hidden = view !== "tracks";
        nleXmlPane.hidden = view !== "xml";
      }
    });
  });

  // --- Interactive #3: Deploy command switcher & copy ---
  let activeDeploy = "docker";
  const deployTabs = document.querySelectorAll("[data-deploy-tab]");
  const deployCode = document.getElementById("deploy-code");
  const copyBtn = document.getElementById("copy-deploy-btn");

  deployTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeDeploy = btn.dataset.deployTab || "docker";
      deployTabs.forEach((b) => {
        const isAct = b === btn;
        b.classList.toggle("is-active", isAct);
        b.setAttribute("aria-selected", String(isAct));
      });
      if (deployCode) {
        deployCode.textContent = DEPLOY_SNIPPETS[activeDeploy] || DEPLOY_SNIPPETS.docker;
      }
    });
  });

  if (copyBtn && deployCode) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(deployCode.textContent || "");
        const prev = copyBtn.textContent;
        copyBtn.textContent = "已复制命令";
        setTimeout(() => {
          copyBtn.textContent = prev;
        }, 1600);
      } catch (_) {}
    });
  }
})();
