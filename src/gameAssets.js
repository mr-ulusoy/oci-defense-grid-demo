function audioSources(basePath) {
    return [`${basePath}.mp3`, `${basePath}.wav`];
}

function loadAudio(scene, key, basePath) {
    if (!scene.cache.audio.exists(key)) {
        scene.load.audio(key, audioSources(basePath));
    }
}

function loadImage(scene, key, path) {
    if (!scene.textures.exists(key)) {
        scene.load.image(key, path);
    }
}

function loadSvg(scene, key, path, config) {
    if (!scene.textures.exists(key)) {
        scene.load.svg(key, path, config);
    }
}

function loadSpritesheet(scene, key, path, config) {
    if (!scene.textures.exists(key)) {
        scene.load.spritesheet(key, path, config);
    }
}

function hasTextures(scene, keys) {
    return keys.every(key => scene.textures.exists(key));
}

function createFrameAnimation(scene, key, textureKey, frameConfig, config) {
    if (scene.anims.exists(key) || !scene.textures.exists(textureKey)) return;

    scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(textureKey, frameConfig),
        ...config
    });
}

function createStaticAnimation(scene, key, textureKey, frame, config) {
    if (scene.anims.exists(key) || !scene.textures.exists(textureKey)) return;

    scene.anims.create({
        key,
        frames: [{ key: textureKey, frame }],
        ...config
    });
}

function createMultiTextureAnimation(scene, key, textureKeys, config) {
    if (scene.anims.exists(key) || !hasTextures(scene, textureKeys)) return;

    scene.anims.create({
        key,
        frames: textureKeys.map(textureKey => ({ key: textureKey })),
        ...config
    });
}

export function loadInitialAssets(scene) {
    loadAudio(scene, 'music-title', 'assets/music/title');
    loadAudio(scene, 'music-level1', 'assets/music/level1');

    loadAudio(scene, 'sfx-explosion', 'assets/sounds/explosion');
    loadAudio(scene, 'sfx-hit', 'assets/sounds/hit');
    loadAudio(scene, 'sfx-powerup', 'assets/sounds/powerup');
    loadAudio(scene, 'sfx-player-death', 'assets/sounds/player-death');

    loadSpritesheet(scene, 'ship', 'assets/sprites/ship.png', {
        frameWidth: 16, frameHeight: 24
    });
    loadSpritesheet(scene, 'enemy-small', 'assets/sprites/enemy-small.png', {
        frameWidth: 16, frameHeight: 16
    });
    loadSpritesheet(scene, 'enemy-medium', 'assets/sprites/enemy-medium.png', {
        frameWidth: 32, frameHeight: 16
    });
    loadSpritesheet(scene, 'enemy-big', 'assets/sprites/enemy-big.png', {
        frameWidth: 32, frameHeight: 32
    });
    loadSpritesheet(scene, 'boss', 'assets/sprites/boss.png', {
        frameWidth: 192, frameHeight: 144
    });
    loadSpritesheet(scene, 'boss-thrust', 'assets/sprites/boss-thrust.png', {
        frameWidth: 64, frameHeight: 48
    });

    loadSpritesheet(scene, 'laser', 'assets/sprites/laser-bolts.png', {
        frameWidth: 16, frameHeight: 16
    });
    loadSpritesheet(scene, 'fireball', 'assets/sprites/fireball.png', {
        frameWidth: 26, frameHeight: 26
    });
    loadSpritesheet(scene, 'powerup', 'assets/sprites/power-up.png', {
        frameWidth: 32, frameHeight: 32
    });
    loadSvg(scene, 'oracle-logo', 'oracle.svg', {
        width: 96,
        height: 96
    });

    loadSpritesheet(scene, 'explosion', 'assets/sprites/explosion.png', {
        frameWidth: 16, frameHeight: 16
    });
    loadSpritesheet(scene, 'explosion-large', 'assets/sprites/explosion-large.png', {
        frameWidth: 32, frameHeight: 32
    });
    loadSpritesheet(scene, 'explosion-big', 'assets/sprites/explosion-big.png', {
        frameWidth: 64, frameHeight: 64
    });
    loadSpritesheet(scene, 'explosion-boss', 'assets/sprites/explosion-boss.png', {
        frameWidth: 80, frameHeight: 80
    });

    loadImage(scene, 'background', 'assets/backgrounds/parallax-space-backgound.png');
    loadImage(scene, 'stars', 'assets/backgrounds/parallax-space-stars.png');
    loadImage(scene, 'far-planets', 'assets/backgrounds/parallax-space-far-planets.png');

    loadImage(scene, 'briefing-storyteller', 'assets/briefings/storyteller2.webp');
    loadImage(scene, 'briefing-region', 'assets/briefings/region.png');
}

export function loadLevelAssets(scene, level) {
    if (level <= 1) {
        loadInitialAssets(scene);
        return;
    }

    if (level === 2) {
        loadAudio(scene, 'music-level2', 'assets/music/level2');
        loadImage(scene, 'desert-bg', 'assets/backgrounds/level2/desert-backgorund.png');
        loadImage(scene, 'desert-clouds', 'assets/backgrounds/level2/clouds.png');
        loadSpritesheet(scene, 'l2-enemy-small', 'assets/sprites/level2/enemy-01.png', {
            frameWidth: 48, frameHeight: 48
        });
        loadSpritesheet(scene, 'l2-enemy-medium', 'assets/sprites/level2/enemy-02.png', {
            frameWidth: 48, frameHeight: 48
        });
        loadSpritesheet(scene, 'l2-enemy-big', 'assets/sprites/level2/enemy-03.png', {
            frameWidth: 48, frameHeight: 48
        });
        loadSpritesheet(scene, 'fire-skull', 'assets/sprites/level2/fire-skull.png', {
            frameWidth: 96, frameHeight: 112
        });
        loadImage(scene, 'lvl2-boss', 'assets/sprites/bosses/lvl2_boss.png');
        loadImage(scene, 'briefing-api-lb', 'assets/briefings/api-lb.png');
        return;
    }

    if (level === 3) {
        loadAudio(scene, 'music-level3', 'assets/music/level3');
        loadImage(scene, 'lava-bg', 'assets/backgrounds/level3/lava-background.png');
        loadSpritesheet(scene, 'lava-flow', 'assets/backgrounds/level3/lava-flow.png', {
            frameWidth: 32, frameHeight: 32
        });
        loadSpritesheet(scene, 'l3-enemy-small', 'assets/sprites/level3/fire-haunt.png', {
            frameWidth: 112, frameHeight: 128
        });
        loadSpritesheet(scene, 'l3-enemy-medium', 'assets/sprites/level3/jumping-demon.png', {
            frameWidth: 101, frameHeight: 98
        });
        loadSpritesheet(scene, 'l3-enemy-big', 'assets/sprites/level3/flying-eye.png', {
            frameWidth: 48, frameHeight: 48
        });
        loadSpritesheet(scene, 'demon-idle', 'assets/sprites/level3/demon-idle.png', {
            frameWidth: 160, frameHeight: 144
        });
        loadSpritesheet(scene, 'demon-attack', 'assets/sprites/level3/demon-attack.png', {
            frameWidth: 240, frameHeight: 192
        });
        loadImage(scene, 'lvl3-boss', 'assets/sprites/bosses/lvl3_boss.png');
        loadImage(scene, 'briefing-compute', 'assets/briefings/compute.png');
        return;
    }

    loadAudio(scene, 'music-level3', 'assets/music/level3');
    loadFinalAssets(scene);

    if (level === 4) {
        loadImage(scene, 'briefing-fn-cache-stream', 'assets/briefings/fn-cache-stream.png');
        return;
    }

    loadLevel5Assets(scene);
    loadImage(scene, 'briefing-adb-object-storage', 'assets/briefings/adb-object-storage.png');
}

export function loadVictoryAssets(scene) {
    loadAudio(scene, 'music-ending', 'assets/music/ending');
}

function loadFinalAssets(scene) {
    loadImage(scene, 'final-bg', 'assets/backgrounds/final/starfield-back.png');
    loadSpritesheet(scene, 'final-asteroids', 'assets/sprites/final/asteroids.png', {
        frameWidth: 48, frameHeight: 48
    });
    loadImage(scene, 'final-enemy-small', 'assets/sprites/final/enemies/enemy-ship1.png');
    loadImage(scene, 'final-enemy-medium', 'assets/sprites/final/enemies/enemy-ship2.png');
    loadImage(scene, 'final-enemy-big', 'assets/sprites/final/enemies/enemy-ship3.png');
    loadImage(scene, 'final-enemy-boss', 'assets/sprites/final/enemies/enemy-ship.png');
    loadImage(scene, 'final-ship-1', 'assets/sprites/final/player/ship-d1.png');
    loadImage(scene, 'final-ship-2', 'assets/sprites/final/player/ship-d2.png');
    loadImage(scene, 'final-ship-3', 'assets/sprites/final/player/ship-d3.png');
    loadImage(scene, 'final-player-bullet-1', 'assets/sprites/final/bullets/bullet-d1.png');
    loadImage(scene, 'final-player-bullet-2', 'assets/sprites/final/bullets/bullet-d2.png');
    loadImage(scene, 'final-player-bullet-3', 'assets/sprites/final/bullets/bullet-d3.png');
    loadImage(scene, 'final-player-bullet-4', 'assets/sprites/final/bullets/bullet-d4.png');
    loadImage(scene, 'final-enemy-bullet-1', 'assets/sprites/final/bullets/bullet-e1.png');
    loadImage(scene, 'final-enemy-bullet-2', 'assets/sprites/final/bullets/bullet-e2.png');
    loadImage(scene, 'final-enemy-bullet-3', 'assets/sprites/final/bullets/bullet-e3.png');
    loadImage(scene, 'final-enemy-bullet-4', 'assets/sprites/final/bullets/bullet-e4.png');
    loadSpritesheet(scene, 'final-explosion', 'assets/sprites/final/effects/explosions-a.png', {
        frameWidth: 32, frameHeight: 32
    });
}

function loadLevel5Assets(scene) {
    loadImage(scene, 'level5-bg', 'assets/backgrounds/level5/blue-with-stars.png');
    loadImage(scene, 'level5-planet-small', 'assets/backgrounds/level5/prop-planet-small.png');
    loadImage(scene, 'level5-planet-big', 'assets/backgrounds/level5/prop-planet-big.png');
    loadImage(scene, 'level5-asteroid-1', 'assets/backgrounds/level5/asteroid-1.png');
    loadImage(scene, 'level5-asteroid-2', 'assets/backgrounds/level5/asteroid-2.png');
}

export function createInitialAnimations(scene) {
    createFrameAnimation(scene, 'ship-idle', 'ship', { start: 0, end: 4 }, {
        frameRate: 10,
        repeat: -1
    });
    createFrameAnimation(scene, 'ship-thrust', 'ship', { start: 5, end: 9 }, {
        frameRate: 15,
        repeat: -1
    });
    createFrameAnimation(scene, 'enemy-small-fly', 'enemy-small', { start: 0, end: 1 }, {
        frameRate: 8,
        repeat: -1
    });
    createFrameAnimation(scene, 'enemy-medium-fly', 'enemy-medium', { start: 0, end: 1 }, {
        frameRate: 10,
        repeat: -1
    });
    createFrameAnimation(scene, 'enemy-big-fly', 'enemy-big', { start: 0, end: 1 }, {
        frameRate: 6,
        repeat: -1
    });
    createFrameAnimation(scene, 'boss-idle', 'boss', { start: 0, end: 1 }, {
        frameRate: 4,
        repeat: -1
    });
    createStaticAnimation(scene, 'boss-damage-1', 'boss', 2, {
        frameRate: 1
    });
    createStaticAnimation(scene, 'boss-damage-2', 'boss', 3, {
        frameRate: 1
    });
    createStaticAnimation(scene, 'boss-damage-3', 'boss', 4, {
        frameRate: 1
    });
    createFrameAnimation(scene, 'boss-thrust', 'boss-thrust', { start: 0, end: 3 }, {
        frameRate: 12,
        repeat: -1
    });
    createFrameAnimation(scene, 'explode', 'explosion', { start: 0, end: 4 }, {
        frameRate: 15,
        repeat: 0
    });
    createFrameAnimation(scene, 'explode-large', 'explosion-large', { start: 0, end: 7 }, {
        frameRate: 15,
        repeat: 0
    });
    createFrameAnimation(scene, 'explode-big', 'explosion-big', { start: 0, end: 7 }, {
        frameRate: 12,
        repeat: 0
    });
    createFrameAnimation(scene, 'explode-boss', 'explosion-boss', { start: 0, end: 6 }, {
        frameRate: 10,
        repeat: 0
    });
    createFrameAnimation(scene, 'fireball-spin', 'fireball', { start: 0, end: 2 }, {
        frameRate: 12,
        repeat: -1
    });
}

export function createLevelAnimations(scene, level) {
    createInitialAnimations(scene);

    if (level === 2) {
        createLevel2Animations(scene);
        return;
    }

    if (level === 3) {
        createLevel3Animations(scene);
        return;
    }

    if (level >= 4) {
        createFinalAnimations(scene);
    }
}

function createLevel2Animations(scene) {
    createFrameAnimation(scene, 'l2-enemy-small-fly', 'l2-enemy-small', { start: 0, end: 4 }, {
        frameRate: 10,
        repeat: -1
    });
    createFrameAnimation(scene, 'l2-enemy-medium-fly', 'l2-enemy-medium', { start: 0, end: 3 }, {
        frameRate: 8,
        repeat: -1
    });
    createFrameAnimation(scene, 'l2-enemy-big-fly', 'l2-enemy-big', { start: 0, end: 3 }, {
        frameRate: 8,
        repeat: -1
    });
    createFrameAnimation(scene, 'fire-skull-idle', 'fire-skull', { start: 0, end: 7 }, {
        frameRate: 10,
        repeat: -1
    });
}

function createLevel3Animations(scene) {
    createFrameAnimation(scene, 'l3-enemy-small-fly', 'l3-enemy-small', { start: 0, end: 4 }, {
        frameRate: 10,
        repeat: -1
    });
    createFrameAnimation(scene, 'l3-enemy-medium-fly', 'l3-enemy-medium', { start: 0, end: 5 }, {
        frameRate: 10,
        repeat: -1
    });
    createFrameAnimation(scene, 'l3-enemy-big-fly', 'l3-enemy-big', { start: 0, end: 7 }, {
        frameRate: 10,
        repeat: -1
    });
    createFrameAnimation(scene, 'demon-idle', 'demon-idle', { start: 0, end: 5 }, {
        frameRate: 8,
        repeat: -1
    });
    createFrameAnimation(scene, 'demon-attack', 'demon-attack', { start: 0, end: 10 }, {
        frameRate: 12,
        repeat: 0
    });
    createFrameAnimation(scene, 'lava-flow', 'lava-flow', { start: 0, end: 2 }, {
        frameRate: 6,
        repeat: -1
    });
}

function createFinalAnimations(scene) {
    createMultiTextureAnimation(scene, 'final-ship-idle', [
        'final-ship-1',
        'final-ship-2',
        'final-ship-3'
    ], {
        frameRate: 8,
        repeat: -1
    });
    createMultiTextureAnimation(scene, 'final-enemy-pulse', [
        'final-enemy-small',
        'final-enemy-medium',
        'final-enemy-big',
        'final-enemy-boss'
    ], {
        frameRate: 6,
        repeat: -1
    });
    createMultiTextureAnimation(scene, 'final-bullet-spin', [
        'final-player-bullet-1',
        'final-player-bullet-2',
        'final-player-bullet-3',
        'final-player-bullet-4'
    ], {
        frameRate: 14,
        repeat: -1
    });
    createMultiTextureAnimation(scene, 'final-enemy-bullet-spin', [
        'final-enemy-bullet-1',
        'final-enemy-bullet-2',
        'final-enemy-bullet-3',
        'final-enemy-bullet-4'
    ], {
        frameRate: 12,
        repeat: -1
    });
    createFrameAnimation(scene, 'final-asteroid-spin', 'final-asteroids', { start: 0, end: 8 }, {
        frameRate: 8,
        repeat: -1
    });
    createFrameAnimation(scene, 'final-explode', 'final-explosion', { start: 0, end: 5 }, {
        frameRate: 16,
        repeat: 0
    });
}
