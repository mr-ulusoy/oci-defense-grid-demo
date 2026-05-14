import { initOciRuntime } from "./ociRuntime.js";
import BootScene from "./scenes/BootScene.js";
import MenuScene from "./scenes/MenuScene.js";
import GameScene from "./scenes/GameScene.js";
import GameOverScene from "./scenes/GameOverScene.js";
import VictoryScene from "./scenes/VictoryScene.js";

const GAME_WIDTH = 480;
const GAME_HEIGHT = 640;
const GAME_ASPECT = GAME_WIDTH / GAME_HEIGHT;
const MAX_MENU_SCALE = 1.35;
const MAX_GAME_SCALE = 1.75;
const MAX_OPS_SCALE = 0.9;
const RENDER_RESOLUTION = Math.min(window.devicePixelRatio || 1, 2);

function sizeGameRoot() {
  const root = document.getElementById("gameRoot");
  const stage = root?.closest(".game-stage");
  if (!root || !stage) return;

  const appShell = document.getElementById("appShell");
  const viewport = window.visualViewport;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const isOps = appShell?.classList.contains("ops-visible") === true;
  const isFullscreenGame = document.body.classList.contains("game-active") && !isOps;
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
  const maxScale = isOps ? MAX_OPS_SCALE : isFullscreenGame ? MAX_GAME_SCALE : MAX_MENU_SCALE;
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
