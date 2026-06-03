import { initOciRuntime } from "./ociRuntime.js?v=20260603-live-toggle";
import BootScene from "./scenes/BootScene.js?v=20260603-live-toggle";
import MenuScene from "./scenes/MenuScene.js?v=20260603-live-toggle";
import GameScene from "./scenes/GameScene.js?v=20260603-live-toggle";
import GameOverScene from "./scenes/GameOverScene.js?v=20260603-live-toggle";
import VictoryScene from "./scenes/VictoryScene.js?v=20260603-live-toggle";

const GAME_WIDTH = 480;
const BASE_GAME_HEIGHT = 640;
const MAX_MENU_SCALE = 1.35;
const MAX_GAME_SCALE = 1.75;
const MAX_OPS_SCALE = 0.9;
const RENDER_RESOLUTION = Math.min(window.devicePixelRatio || 1, 2);
const isMobileViewport =
  window.matchMedia?.("(max-width: 820px), (pointer: coarse)")?.matches === true;
const initialViewportWidth = Math.max(1, window.visualViewport?.width ?? window.innerWidth);
const initialViewportHeight = window.visualViewport?.height ?? window.innerHeight;
const GAME_HEIGHT = isMobileViewport
  ? Math.min(920, Math.max(BASE_GAME_HEIGHT, Math.round(GAME_WIDTH * (initialViewportHeight / initialViewportWidth))))
  : BASE_GAME_HEIGHT;
const GAME_ASPECT = GAME_WIDTH / GAME_HEIGHT;
let stableFullscreenViewport = {
  width: window.innerWidth,
  height: window.innerHeight
};

function sizeGameRoot() {
  const root = document.getElementById("gameRoot");
  const stage = root?.closest(".game-stage");
  if (!root || !stage) return;

  const appShell = document.getElementById("appShell");
  const viewport = window.visualViewport;
  const visualViewportWidth = viewport?.width ?? window.innerWidth;
  const visualViewportHeight = viewport?.height ?? window.innerHeight;
  const isOps = appShell?.classList.contains("ops-visible") === true;
  const isFullscreenGame = document.body.classList.contains("game-active") && !isOps;
  const focusedElement = document.activeElement;
  const hasGameTextFocus =
    focusedElement?.nodeType === 1 &&
    root.contains(focusedElement) &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(focusedElement.tagName);

  if (isFullscreenGame && !hasGameTextFocus) {
    stableFullscreenViewport = {
      width: visualViewportWidth,
      height: Math.max(visualViewportHeight, window.innerHeight)
    };
  }

  const viewportWidth = isFullscreenGame && hasGameTextFocus
    ? stableFullscreenViewport.width
    : visualViewportWidth;
  const viewportHeight = isFullscreenGame && hasGameTextFocus
    ? stableFullscreenViewport.height
    : visualViewportHeight;
  const stageStyle = window.getComputedStyle(stage);
  const stageRect = stage.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const horizontalPadding =
    parseFloat(stageStyle.paddingLeft || "0") + parseFloat(stageStyle.paddingRight || "0");
  const bottomPadding = parseFloat(stageStyle.paddingBottom || "0");
  const availableWidth = Math.max(240, Math.min(viewportWidth, stageRect.width) - horizontalPadding);
  const availableHeight = isFullscreenGame
    ? Math.max(320, viewportHeight - bottomPadding)
    : Math.max(320, viewportHeight - rootRect.top - bottomPadding - 34);
  const fullscreenMaxScale = isMobileViewport ? Number.POSITIVE_INFINITY : MAX_GAME_SCALE;
  const maxScale = isOps ? MAX_OPS_SCALE : isFullscreenGame ? fullscreenMaxScale : MAX_MENU_SCALE;
  const width = Math.floor(Math.min(GAME_WIDTH * maxScale, availableWidth, availableHeight * GAME_ASPECT));
  const height = Math.floor(width / GAME_ASPECT);

  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
}

async function boot() {
  await initOciRuntime();
  sizeGameRoot();

  const config = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: "gameRoot",
    pixelArt: true,
    resolution: RENDER_RESOLUTION,
    physics: {
      default: "arcade",
      arcade: {
        gravity: { y: 0 },
        debug: false
      }
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [BootScene, MenuScene, GameScene, GameOverScene, VictoryScene]
  };

  const game = new Phaser.Game(config);
  const refreshGameSize = () => {
    sizeGameRoot();
    game.scale.refresh();
  };
  window.OCI_DEFENSE_LAYOUT_CHANGED = () => {
    window.requestAnimationFrame(refreshGameSize);
  };

  window.addEventListener("resize", refreshGameSize);
  window.addEventListener("orientationchange", refreshGameSize);
  window.visualViewport?.addEventListener("resize", refreshGameSize);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (game.sound && game.sound.context && game.sound.context.state === "suspended") {
        game.sound.context.resume();
      }
    }
  });

  document.addEventListener(
    "touchstart",
    () => {
      if (game.sound && game.sound.context && game.sound.context.state === "suspended") {
        game.sound.context.resume();
      }
    },
    { once: false }
  );
}

boot();
