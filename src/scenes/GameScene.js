import { askCoach, askCopilot, emitGameEvent, telemetry, updateHud } from "../ociRuntime.js";
import { createLevelAnimations, loadLevelAssets } from "../gameAssets.js?v=20260528-lvl3-boss-v2";

const BRIEFINGS_BY_LEVEL = {
    1: {
        title: 'REGIONS AND FAULT DOMAINS',
        imageKey: 'briefing-region',
        guideKey: 'briefing-storyteller',
        durationMs: 45000,
        lines: [
            'Oracle Cloud Infrastructure is hosted in regions across the world, giving workloads geographic separation from other cities, power grids, network paths, and natural disaster zones.',
            'This demo is deployed into one selected OCI region. The Terraform region variable decides where the full stack lands, so another team can run the same architecture in their own preferred region.',
            'Inside the region, the demo builds a VCN with public and private subnets. The public entry points expose the Load Balancer and API Gateway, while the Compute VM fleet runs privately behind them.',
            'Fault domains provide anti-affinity: they let the VM fleet spread across separate physical hardware, reducing the chance that one hardware failure affects every game server.',
            'Regional services such as Functions, Streaming, OCI Cache, Autonomous Database, and Object Storage stay close to the game traffic, keeping the architecture compact, repeatable, and easy to tear down after the demo.'
        ]
    },
    2: {
        title: 'API GATEWAY AND LOAD BALANCER',
        imageKey: 'briefing-api-lb',
        guideKey: 'briefing-storyteller',
        durationMs: 43000,
        lines: [
            'The Load Balancer serves the game from one public entry point and distributes player traffic across healthy Compute VMs inside the VCN.',
            'Health checks make the fleet resilient: unhealthy instances stop receiving traffic, while healthy VMs continue serving the mission.',
            'API Gateway is the controlled front door for /api/* calls. It can validate requests, handle CORS, enforce authentication and authorization, apply request limits, and route traffic to Functions or VM APIs.',
            'Together they split the paths: the browser loads the game through the Load Balancer, while telemetry, leaderboard, and copilot calls go through API Gateway.'
        ]
    },
    3: {
        title: 'COMPUTE VMS AND INSTANCE POOLS',
        imageKey: 'briefing-compute',
        guideKey: 'briefing-storyteller',
        durationMs: 40000,
        lines: [
            'OCI Compute VMs run the game servers and Node APIs behind the Load Balancer. In this demo, each VM can serve the frontend and answer health, status, and gameplay API requests.',
            'Flexible shapes let us choose the OCPUs and memory each VM needs. Network bandwidth and VNIC capacity scale with the selected OCPU count, so the shape can match the workload.',
            'Instance pools manage multiple VMs as one fleet. The pool can attach to the Load Balancer, place instances across fault domains or subnets, and grow or shrink during autoscaling.',
            'When demand rises, the fleet adds workers. When the mission calms down, it scales back so the demo keeps performance high without leaving idle capacity behind.'
        ]
    },
    4: {
        title: 'FUNCTIONS CACHE AND STREAMING',
        imageKey: 'briefing-fn-cache-stream',
        guideKey: 'briefing-storyteller',
        durationMs: 43000,
        lines: [
            'OCI Functions runs event-handling code without managing servers. In this demo, gameplay telemetry can arrive through API Gateway and be processed by a serverless function.',
            'OCI Cache keeps live state fast. Active pilots, current scores, and presenter dashboard data can be read quickly without waiting for permanent database writes.',
            'OCI Streaming is the durable event stream. It ingests high-volume messages in real time and decouples producers from consumers, so analytics and storage can move at their own pace.',
            'Together they make the mission responsive: Functions process signals, Cache keeps the live battlefield fresh, and Streaming preserves the event flow for downstream services.'
        ]
    },
    5: {
        title: 'ADB AND OBJECT STORAGE',
        imageKey: 'briefing-adb-object-storage',
        guideKey: 'briefing-storyteller',
        durationMs: 45000,
        lines: [
            'Autonomous Database is the source of truth for leaderboard, run summaries, and Event Analytics. It automates provisioning, backups, patching, upgrades, and elastic scaling.',
            'Compute and storage can grow or shrink without downtime or service interruption. With Autonomous Data Guard enabled, Oracle highlights a 99.995% availability SLA for mission-critical deployments.',
            'Object Storage archives raw gameplay events as durable objects. It stores unstructured data at internet scale and is not tied to any single Compute instance.',
            'For durability, Object Storage is designed for 99.999999999% annual durability. It stores data redundantly across availability domains or fault domains, monitors integrity with checksums, and repairs corrupt data automatically.'
        ]
    }
};

const QUIZ_BY_LEVEL = {
    1: {
        id: 'region-fault-domains',
        title: 'REGION CHECK',
        prompt: 'Why does this demo use one OCI region with fault-domain-aware placement?',
        options: [
            'A region keeps services close, and fault domains reduce shared hardware failure risk.',
            'A region is only a billing label, and fault domains are used for public DNS.',
            'Fault domains replace the Load Balancer and route all traffic directly to one VM.'
        ],
        correctIndex: 0,
        explanation: 'Correct. The selected region keeps the stack close to game traffic, while fault domains help spread VMs across separate physical hardware.'
    },
    2: {
        id: 'api-lb-route',
        title: 'ROUTING CHECK',
        prompt: 'Which traffic path is correct in this demo?',
        options: [
            'The game loads through the public Load Balancer, while /api/* calls go through API Gateway.',
            'All browser and API traffic bypasses API Gateway and talks directly to every VM.',
            'Object Storage serves the live game and sends player controls to the Load Balancer.'
        ],
        correctIndex: 0,
        explanation: 'Correct. Public LB is the game entry point; API Gateway is the controlled front door for telemetry, leaderboard and coach calls.'
    },
    3: {
        id: 'compute-instance-pool',
        title: 'COMPUTE CHECK',
        prompt: 'What does the instance pool demonstrate?',
        options: [
            'Multiple VMs managed as one fleet, attached to the Load Balancer and able to scale.',
            'One permanent VM that manually stores every raw event on local disk.',
            'A database feature that replaces Compute when player traffic grows.'
        ],
        correctIndex: 0,
        explanation: 'Correct. The pool treats multiple VMs as one fleet, so the demo can show health, failover and autoscaling.'
    },
    4: {
        id: 'functions-cache-streaming',
        title: 'EVENT FLOW CHECK',
        prompt: 'Which service keeps live player state fast?',
        options: [
            'OCI Cache keeps live player state fast; Functions processes events and Streaming buffers event flow.',
            'Streaming stores only the final high score, while Cache archives all raw payload files.',
            'Functions is the long-term SQL database for leaderboard analytics.'
        ],
        correctIndex: 0,
        explanation: 'Correct. Cache is the fast live-state layer, Functions handles event code, and Streaming keeps telemetry durable and decoupled.'
    },
    5: {
        id: 'adb-object-storage',
        title: 'DATA CHECK',
        prompt: 'Where do curated analytics and raw events go?',
        options: [
            'Autonomous Database stores game_events and highscores; Object Storage archives raw NDJSON events.',
            'Object Storage runs SQL analytics, while Autonomous Database stores only background images.',
            'Both curated analytics and raw event archives are kept only in browser memory.'
        ],
        correctIndex: 0,
        explanation: 'Correct. ADB is the queryable source of truth; Object Storage keeps durable raw event archives.'
    }
};

export default class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init(data) {
        // Level system
        this.level = data.level || 1;
        this.maxLevel = 5;
        this.callsign = data.callsign || localStorage.getItem('playerCallsign') || 'UNKNOWN';
        this.wave = 1;
        // Level 4+ enters overdrive with longer stages.
        this.wavesPerLevel = Math.min(5, (this.level === 1 ? 2 : 3) + Math.max(0, this.level - 3));
        if (this.isFinalLevel()) {
            this.wavesPerLevel = 3;
        }
        this.waveInProgress = false;

        // Player stats
        this.lives = data.lives ?? 3;
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.score = data.score || 0;
        this.isInvincible = false;
        this.isDead = false;

        // Player movement
        this.playerSpeed = 200;
        this.playerSpeedBoost = 1;

        // Weapon stats - faster firing to handle more enemies!
        this.bulletSpeed = 450;
        this.lastFired = 0;
        this.fireRate = 150; // Faster fire rate
        this.weaponLevel = data.weaponLevel || 1;

        // Boss state
        this.bossActive = false;
        this.boss = null;
        this.bossHP = 0;
        this.bossMaxHP = 0;
        this.lastOciHudUpdate = 0;
        this.lastTelemetryHeartbeat = 0;

        // Timers
        this.shieldActive = false;
        this.shieldTimer = null;
        this.speedBoostTimer = null;

        // Fireball powerup (piercing shots)
        this.fireballActive = false;
        this.fireballTimer = null;
        this.educationOverlayActive = false;

        // Touch controls
        this.touchPointer = null;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.playerStartX = 0;
        this.playerStartY = 0;
    }

    preload() {
        loadLevelAssets(this, this.level);
    }

    create() {
        createLevelAnimations(this, this.level);
        this.physics.world.setBounds(0, 0, 480, this.scale.height);

        if (!document.getElementById('appShell')?.classList.contains('ops-visible')) {
            document.body.classList.add('game-active');
            this.setMobileStageBackdrop();
        }
        window.OCI_DEFENSE_LAYOUT_CHANGED?.();

        // Create backgrounds based on level
        this.createBackgrounds();

        // Create player
        this.createPlayer();

        // Create groups
        this.bullets = this.physics.add.group();
        this.enemyBullets = this.physics.add.group();
        this.enemies = this.physics.add.group();
        this.powerups = this.physics.add.group();
        this.bossGroup = this.physics.add.group(); // Dedicated group for boss

        // Setup input
        this.setupInput();

        // Setup collisions
        this.physics.add.overlap(this.bullets, this.enemies, this.hitEnemy, null, this);
        this.physics.add.overlap(this.player, this.enemies, this.playerHitByEnemy, null, this);
        this.physics.add.overlap(this.player, this.enemyBullets, this.playerHitByBullet, null, this);
        this.physics.add.overlap(this.player, this.powerups, this.collectPowerup, null, this);

        // Create UI
        this.createUI();

        // Stop any previous music before starting new
        this.sound.stopAll();

        // Setup sounds
        this.sounds = {
            explosion: this.sound.add('sfx-explosion', { volume: 0.6 }),
            hit: this.sound.add('sfx-hit', { volume: 0.5 }),
            powerup: this.sound.add('sfx-powerup', { volume: 0.6 }),
            playerDeath: this.sound.add('sfx-player-death', { volume: 0.5 })
        };

        // Start level music
        const musicKey = `music-level${Math.min(this.level, 3)}`;
        this.music = this.sound.add(musicKey, { loop: true, volume: 0.4 });
        this.music.play();

        // Show the OCI briefing first, then start the level.
        this.startLevelFlow();
    }

    isFinalLevel() {
        return this.level >= this.maxLevel;
    }

    usesFinalAssetStyle() {
        return this.level >= 4;
    }

    startLevelFlow() {
        const beginGameplay = () => {
            this.restoreStageAfterOverlay();
            updateHud(this.snapshot());
            this.sendTelemetry('heartbeat');
            this.showLevelIntro();
        };

        if (BRIEFINGS_BY_LEVEL[this.level]) {
            this.showEducationOverlay(this.level, beginGameplay);
            return;
        }

        beginGameplay();
    }

    // ============== BACKGROUNDS ==============

    setMobileStageBackdrop() {
        const levelClass = `game-level-${Math.min(Math.max(this.level, 1), this.maxLevel)}`;
        document.body.classList.remove(
            'game-level-1',
            'game-level-2',
            'game-level-3',
            'game-level-4',
            'game-level-5'
        );
        document.body.classList.add(levelClass);
    }

    createBackgrounds() {
        // Clear any existing background elements
        this.bgLayers = [];
        this.level5Props = [];
        const height = this.scale.height;
        const centerY = height / 2;

        // Use static images for backgrounds (no seams), tileSprites only for stars
        if (this.level >= 5) {
            // Level 5: blue nebula from the imported Game asset pack.
            this.bg = this.add.tileSprite(0, 0, 480, height, 'level5-bg')
                .setOrigin(0, 0)
                .setTileScale(2);

            const planetBig = this.add.image(96, 150, 'level5-planet-big')
                .setScale(3.2)
                .setAlpha(0.85)
                .setDepth(1);
            const planetSmall = this.add.image(386, 92, 'level5-planet-small')
                .setScale(2.4)
                .setAlpha(0.75)
                .setDepth(1);
            const asteroidOne = this.add.image(372, 300, 'level5-asteroid-1')
                .setScale(2.1)
                .setAlpha(0.78)
                .setDepth(2);
            const asteroidTwo = this.add.image(104, 420, 'level5-asteroid-2')
                .setScale(2.2)
                .setAlpha(0.7)
                .setDepth(2);

            this.level5Props = [
                { sprite: planetBig, speed: 0.18, resetY: -80 },
                { sprite: planetSmall, speed: 0.24, resetY: -45 },
                { sprite: asteroidOne, speed: 0.72, resetY: -55 },
                { sprite: asteroidTwo, speed: 0.58, resetY: -45 }
            ];

            this.bgLayers = [
                { sprite: this.bg, speed: 0.82, isTileSprite: true }
            ];
        } else if (this.usesFinalAssetStyle()) {
            // Level 4: star fighter overdrive from the imported Game asset pack.
            this.bg = this.add.tileSprite(0, 0, 480, height, 'final-bg')
                .setOrigin(0, 0)
                .setTileScale(1.6)
                .setTint(0xb7d7ff);
            this.finalStars = this.add.tileSprite(0, 0, 480, height, 'stars')
                .setOrigin(0, 0)
                .setTileScale(2)
                .setAlpha(0.45)
                .setTint(0x8fd8ff);

            this.bgLayers = [
                { sprite: this.bg, speed: 0.7, isTileSprite: true },
                { sprite: this.finalStars, speed: 1.0, isTileSprite: true }
            ];
        } else if (this.level === 1) {
            // Level 1: Deep space - static background, scrolling stars
            this.bg = this.add.image(240, centerY, 'background')
                .setDisplaySize(480, height);
            this.farPlanets = this.add.image(240, centerY, 'far-planets')
                .setDisplaySize(480, height);
            this.stars = this.add.tileSprite(0, 0, 480, height, 'stars')
                .setOrigin(0, 0).setTileScale(2);

            this.bgLayers = [
                { sprite: this.stars, speed: 0.5, isTileSprite: true }
            ];
        } else if (this.level === 2) {
            // Level 2: Desert Canyon
            this.bg = this.add.image(240, centerY, 'desert-bg')
                .setDisplaySize(480, height);
            this.clouds = this.add.tileSprite(0, 0, 480, height, 'desert-clouds')
                .setOrigin(0, 0).setTileScale(3).setAlpha(0.4);

            this.bgLayers = [
                { sprite: this.clouds, speed: 0.3, isTileSprite: true }
            ];
        } else {
            // Level 3: Lava/Hell.
            this.bg = this.add.image(240, centerY, 'lava-bg')
                .setDisplaySize(480, height);

            // Rising embers effect - reuse stars with orange tint, scrolling UP
            this.embers = this.add.tileSprite(0, 0, 480, height, 'stars')
                .setOrigin(0, 0).setTileScale(2).setAlpha(0.5).setTint(0xff6600);

            // Animated lava flow at the bottom
            this.lavaSprites = [];
            for (let i = 0; i < 16; i++) {
                const lava = this.add.sprite(i * 32, height - 20, 'lava-flow')
                    .setScale(1).setOrigin(0, 0.5).setDepth(2);
                lava.play('lava-flow');
                lava.anims.setProgress(i * 0.0625); // Offset timing
                this.lavaSprites.push(lava);
            }

            this.bgLayers = [
                { sprite: this.embers, speed: -0.3 - Math.max(0, this.level - 3) * 0.08, isTileSprite: true }
            ];
        }
    }

    // ============== PLAYER ==============

    createPlayer() {
        const playerConfig = this.usesFinalAssetStyle()
            ? { key: 'final-ship-1', anim: 'final-ship-idle', scale: 2.35, size: [24, 30] }
            : { key: 'ship', anim: 'ship-idle', scale: 2.55, size: [10, 17] };

        this.player = this.physics.add.sprite(240, this.scale.height - 90, playerConfig.key);
        this.player.setScale(playerConfig.scale);
        this.player.setCollideWorldBounds(true);
        this.player.play(playerConfig.anim);
        this.player.setSize(playerConfig.size[0], playerConfig.size[1]);
        this.player.setDepth(10);

        this.shieldSprite = this.add.graphics();
        this.shieldSprite.setDepth(11);
    }

    setupInput() {
        // Keyboard
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys({
            up: Phaser.Input.Keyboard.KeyCodes.W,
            down: Phaser.Input.Keyboard.KeyCodes.S,
            left: Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D
        });
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

        // Debug: Z key to skip to boss immediately
        this.input.keyboard.on('keydown-Z', () => {
            if (!this.bossActive && !this.isDead && !this.educationOverlayActive) {
                // Stop current wave spawning
                if (this.enemySpawnTimer) this.enemySpawnTimer.remove();
                // Clear all enemies
                this.enemies.clear(true, true);
                this.waveInProgress = false;
                // Start boss fight
                this.startBossFight();
            }
        });

        // Secret: X key to skip to next level
        this.input.keyboard.on('keydown-X', () => {
            if (!this.isDead && !this.isSkipping && !this.educationOverlayActive) {
                this.isSkipping = true;
                // Stop all spawning and clear enemies
                if (this.enemySpawnTimer) this.enemySpawnTimer.remove();
                this.enemies.clear(true, true);
                this.bossGroup.clear(true, true);
                this.enemyBullets.clear(true, true);
                this.bossActive = false;
                this.waveInProgress = false;

                if (this.level >= this.maxLevel) {
                    // Victory!
                    this.scene.start('VictoryScene', {
                        score: this.score,
                        callsign: this.callsign,
                        runId: telemetry.runId
                    });
                } else {
                    // Next level
                    this.scene.start('GameScene', {
                        level: this.level + 1,
                        score: this.score,
                        weaponLevel: this.weaponLevel,
                        callsign: this.callsign,
                        lives: this.lives
                    });
                }
            }
        });

        // Touch controls - relative movement (drag direction controls ship)
        this.input.on('pointerdown', (pointer) => {
            if (this.educationOverlayActive) return;
            this.touchPointer = pointer;
            this.touchStartX = pointer.x;
            this.touchStartY = pointer.y;
            this.playerStartX = this.player.x;
            this.playerStartY = this.player.y;
        });

        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown && !this.isDead && !this.educationOverlayActive && this.touchPointer) {
                // Calculate delta from touch start position
                const deltaX = pointer.x - this.touchStartX;
                const deltaY = pointer.y - this.touchStartY;

                // Apply delta to player's starting position
                const newX = this.playerStartX + deltaX;
                const newY = this.playerStartY + deltaY;

                this.player.x = Phaser.Math.Clamp(newX, 30, 450);
                this.player.y = Phaser.Math.Clamp(newY, 30, this.scale.height - 30);
            }
        });

        this.input.on('pointerup', () => {
            this.touchPointer = null;
        });
    }

    // ============== UI ==============

    createUI() {
        // Score
        this.scoreText = this.add.text(16, 16, 'SCORE: ' + this.score, {
            fontFamily: 'monospace', fontSize: '18px',
            fill: '#fff', stroke: '#000', strokeThickness: 3
        }).setDepth(100);

        // Level & Wave
        this.levelText = this.add.text(240, 16, `LEVEL ${this.level}`, {
            fontFamily: 'monospace', fontSize: '18px',
            fill: '#ff0', stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5, 0).setDepth(100);

        // Lives icon and text
        this.livesIcon = this.add.sprite(420, 22, 'ship', 0).setScale(1.2).setDepth(100);
        this.livesText = this.add.text(438, 14, this.lives.toString(), {
            fontFamily: 'monospace', fontSize: '20px',
            fill: '#0f0', stroke: '#000', strokeThickness: 3
        }).setDepth(100);

        // Health bar
        const healthY = this.scale.height - 20;
        this.healthBarBg = this.add.rectangle(240, healthY, 200, 14, 0x333333).setDepth(100);
        this.healthBar = this.add.rectangle(141, healthY, 196, 10, 0x00ff00)
            .setOrigin(0, 0.5).setDepth(100);
        this.healthBorder = this.add.rectangle(240, healthY, 200, 14).setStrokeStyle(2, 0xffffff).setDepth(100);

        // Announcement text
        this.announceText = this.add.text(240, 300, '', {
            fontFamily: 'monospace', fontSize: '42px',
            fill: '#fff', stroke: '#000', strokeThickness: 6
        }).setOrigin(0.5).setDepth(100).setAlpha(0);

        this.oracleLogo = this.add.image(240, 56, 'oracle-logo')
            .setDisplaySize(42, 42)
            .setDepth(99)
            .setAlpha(0.85);

        // Boss health bar (hidden initially)
        this.createBossHealthBar();
    }

    createBossHealthBar() {
        this.bossHealthContainer = this.add.container(240, 60).setDepth(100).setVisible(false);

        const label = this.add.text(0, -20, 'BOSS', {
            fontFamily: 'monospace', fontSize: '16px',
            fill: '#f00', stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5);

        const bg = this.add.rectangle(0, 0, 300, 20, 0x333333);
        this.bossHealthBar = this.add.rectangle(-148, 0, 296, 16, 0xff0000).setOrigin(0, 0.5);
        const border = this.add.rectangle(0, 0, 300, 20).setStrokeStyle(2, 0xffffff);

        this.bossHealthContainer.add([label, bg, this.bossHealthBar, border]);
    }

    updateLevel5Props() {
        if (!this.level5Props) return;

        this.level5Props.forEach(({ sprite, speed, resetY }) => {
            if (!sprite || !sprite.active) return;
            sprite.y += speed;
            if (sprite.y > this.scale.height + 60) sprite.y = resetY;
        });
    }

    // ============== GAME LOOP ==============

    update(time) {
        if (this.isDead) return;

        if (this.educationOverlayActive) {
            this.updateOciHud(time);
            return;
        }

        // Scroll backgrounds
        this.bgLayers.forEach(layer => {
            layer.sprite.tilePositionY -= layer.speed;
        });
        this.updateLevel5Props();

        // Level 2 planet movement
        if (this.level === 2) {
            if (this.bigPlanet) this.bigPlanet.y += 0.1;
            if (this.ringPlanet) this.ringPlanet.y += 0.15;
        }

        // Player
        this.handlePlayerMovement();
        this.handleShooting(time);
        this.updateShield();

        // Enemies
        this.updateEnemies(time);

        // Boss
        if (this.bossActive && this.boss) {
            this.updateBoss(time);
        }

        // Cleanup
        this.cleanupOffscreen();

        // Check wave/boss completion
        if (!this.bossActive) {
            this.checkWaveComplete();
        }

        this.updateOciHud(time);
    }

    handlePlayerMovement() {
        // Skip if touch is active
        if (this.touchPointer && this.touchPointer.isDown) {
            this.player.play('ship-idle', true);
            return;
        }

        const { left, right, up, down } = this.cursors;
        let velocityX = 0;
        let velocityY = 0;
        const speed = this.playerSpeed * this.playerSpeedBoost;

        if (left.isDown || this.wasd.left.isDown) velocityX = -speed;
        else if (right.isDown || this.wasd.right.isDown) velocityX = speed;

        if (up.isDown || this.wasd.up.isDown) velocityY = -speed;
        else if (down.isDown || this.wasd.down.isDown) velocityY = speed;

        this.player.setVelocity(velocityX, velocityY);
        this.player.play(velocityY < 0 ? 'ship-thrust' : 'ship-idle', true);
    }

    handleShooting(time) {
        const isShooting = this.spaceKey.isDown ||
            (this.touchPointer && this.touchPointer.isDown);

        if (isShooting && time > this.lastFired) {
            this.fireBullet();
            this.lastFired = time + this.fireRate;
        }
    }

    fireBullet() {
        const x = this.player.x;
        const y = this.player.y - 20;

        if (this.weaponLevel === 1) {
            this.createBullet(x, y, 0);
        } else if (this.weaponLevel === 2) {
            this.createBullet(x - 15, y, 0);
            this.createBullet(x + 15, y, 0);
        } else {
            this.createBullet(x, y, 0);
            this.createBullet(x - 15, y + 5, -50);
            this.createBullet(x + 15, y + 5, 50);
        }
    }

    createBullet(x, y, velocityX) {
        if (this.usesFinalAssetStyle()) {
            const bullet = this.bullets.create(x, y, this.fireballActive ? 'final-player-bullet-4' : 'final-player-bullet-1');
            bullet.setScale(this.fireballActive ? 2.75 : 2.25);
            bullet.body.setSize(8, 12);
            bullet.setVelocity(velocityX * (this.fireballActive ? 0.9 : 1), -this.bulletSpeed * (this.fireballActive ? 0.95 : 1.08));

            if (this.fireballActive) {
                bullet.play('final-bullet-spin');
                bullet.isPiercing = true;
            }
            return;
        }

        if (this.fireballActive) {
            // Fireball - piercing shot
            const bullet = this.bullets.create(x, y, 'fireball');
            bullet.setScale(1.5);
            bullet.play('fireball-spin');
            bullet.body.setSize(20, 20);
            bullet.setVelocity(velocityX * 0.8, -this.bulletSpeed * 0.9);
            bullet.isPiercing = true; // Mark as piercing
        } else {
            // Normal laser
            const bullet = this.bullets.create(x, y, 'laser', 0);
            bullet.setScale(2);
            bullet.body.setSize(8, 14);
            bullet.setVelocity(velocityX, -this.bulletSpeed);
        }
    }

    updateShield() {
        this.shieldSprite.clear();
        if (this.shieldActive) {
            this.shieldSprite.lineStyle(3, 0x00ffff, 0.8);
            this.shieldSprite.strokeCircle(this.player.x, this.player.y, 35);
        }
    }

    // ============== WAVE SYSTEM ==============

    showLevelIntro() {
        const label = this.isFinalLevel()
            ? `LEVEL ${this.level}\nFINAL GRID`
            : (this.level >= 4 ? `LEVEL ${this.level}\nOVERDRIVE` : `LEVEL ${this.level}`);
        this.announceText.setText(label);
        this.announceText.setAlpha(1);
        this.oracleLogo.setAlpha(0.95);

        this.tweens.add({
            targets: this.announceText,
            alpha: 0,
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                this.tweens.add({
                    targets: this.oracleLogo,
                    alpha: 0.2,
                    duration: 700,
                    ease: 'Power2'
                });
                this.time.delayedCall(500, () => this.startWave());
            }
        });
    }

    startWave() {
        if (this.wave > this.wavesPerLevel) {
            // All waves done, spawn boss
            this.startBossFight();
            return;
        }

        this.waveInProgress = true;
        this.levelText.setText(`LEVEL ${this.level} - WAVE ${this.wave}`);

        this.announceText.setText(`WAVE ${this.wave}`);
        this.announceText.setAlpha(1);
        this.tweens.add({
            targets: this.announceText,
            alpha: 0,
            duration: 1500,
            ease: 'Power2'
        });

        const overdrive = Math.max(0, this.level - 3);
        const baseCount = 8 + (this.level * 4) + (this.wave * 4);
        let enemyCount = baseCount + overdrive * 6 + Math.max(0, this.wave - 2) * overdrive * 2;
        if (this.level === 2) enemyCount += 4;
        if (this.level >= 3) enemyCount += 6;
        if (this.usesFinalAssetStyle()) enemyCount += 8;
        if (this.level === 4) {
            enemyCount = Math.max(32, Math.floor(enemyCount * 0.72));
        }
        if (this.isFinalLevel()) {
            enemyCount = Math.max(18, Math.floor(enemyCount * 0.38));
        }
        this.spawnWaveEnemies(enemyCount);
    }

    spawnWaveEnemies(count) {
        let spawned = 0;
        const overdrive = Math.max(0, this.level - 3);
        let spawnDelay = Math.max(150, 800 - (this.level * 80) - (this.wave * 40) - overdrive * 35);
        if (this.level >= 3) spawnDelay = Math.max(140, spawnDelay - 50);
        if (this.usesFinalAssetStyle()) spawnDelay = Math.max(105, spawnDelay - 35);
        if (this.level === 4) spawnDelay = Math.max(290, spawnDelay + 95);
        if (this.isFinalLevel()) spawnDelay = Math.max(330, spawnDelay + 230);

        this.enemySpawnTimer = this.time.addEvent({
            delay: spawnDelay,
            callback: () => {
                if (spawned < count && !this.isDead && !this.bossActive) {
                    this.spawnEnemy();
                    spawned++;
                }
            },
            repeat: count - 1
        });
    }

    spawnEnemy() {
        const x = Phaser.Math.Between(50, 430);
        const rand = Math.random();
        // Higher chances for tougher enemies = more chaos!
        const overdrive = Math.max(0, this.level - 3);
        let bigChance = Math.min(0.08 + (this.level * 0.06) + (this.wave * 0.03) + overdrive * 0.03, 0.42);
        let mediumChance = Math.min(0.25 + (this.level * 0.08) + (this.wave * 0.04) + overdrive * 0.04, 0.62);
        if (this.level === 4) {
            bigChance = Math.min(0.12 + this.wave * 0.02, 0.2);
            mediumChance = Math.min(0.3 + this.wave * 0.025, 0.42);
        }
        if (this.isFinalLevel()) {
            bigChance = Math.min(0.06 + this.wave * 0.015, 0.12);
            mediumChance = Math.min(0.18 + this.wave * 0.02, 0.28);
        }

        if (rand < bigChance) {
            this.createBigEnemy(x);
        } else if (rand < bigChance + mediumChance) {
            this.createMediumEnemy(x);
        } else {
            const congaChance = this.isFinalLevel()
                ? 0.08
                : Math.min(0.25 + overdrive * 0.06, 0.45);
            if (this.level >= 2 && Math.random() < congaChance) {
                this.spawnCongaLine(x);
            } else {
                this.createSmallEnemy(x);
            }
        }
    }

    spawnCongaLine(x) {
        const count = this.isFinalLevel()
            ? Phaser.Math.Between(2, 3)
            : Phaser.Math.Between(3, Math.min(7, 4 + Math.max(0, this.level - 3)));
        const delay = this.isFinalLevel()
            ? 170
            : Math.max(85, 150 - Math.max(0, this.level - 3) * 15);
        for (let i = 0; i < count; i++) {
            this.time.delayedCall(i * delay, () => {
                if (!this.isDead && !this.bossActive) {
                    this.createSmallEnemy(x + Phaser.Math.Between(-20, 20));
                }
            });
        }
    }

    createSmallEnemy(x) {
        // Level-specific sprites - normalized to ~48px display size
        const sprites = {
            1: { key: 'enemy-small', anim: 'enemy-small-fly', scale: 3, size: [14, 14] },       // 16*3=48
            2: { key: 'l2-enemy-small', anim: 'l2-enemy-small-fly', scale: 1.0, size: [40, 40] }, // 48*1=48
            3: { key: 'l3-enemy-small', anim: 'l3-enemy-small-fly', scale: 0.45, size: [45, 50] } // 112*0.45=50
        };
        const s = this.usesFinalAssetStyle()
            ? { key: 'final-enemy-small', anim: null, scale: 1.35, size: [30, 30] }
            : (sprites[Math.min(this.level, 3)] || sprites[1]);

        const enemy = this.enemies.create(x, -30, s.key);
        enemy.setScale(s.scale);
        if (s.anim) enemy.play(s.anim);
        enemy.setSize(s.size[0], s.size[1]);
        enemy.enemyType = 'small';
        enemy.health = this.usesFinalAssetStyle() ? (this.isFinalLevel() ? 1 : 2) : 1;
        enemy.points = 100 + Math.max(0, this.level - 3) * 25 + (this.usesFinalAssetStyle() ? 75 : 0);
        enemy.setVelocityY(Phaser.Math.Between(120 + this.level * 20, Math.min(420, 220 + this.level * 25)));
        const driftAmount = this.level >= 2 ? Math.min(140, 80 + this.level * 10) : 60;
        enemy.setVelocityX(Phaser.Math.Between(-driftAmount, driftAmount));
    }

    createMediumEnemy(x) {
        // Level-specific sprites - normalized to ~80-90px display size
        const sprites = {
            1: { key: 'enemy-medium', anim: 'enemy-medium-fly', scale: 3, size: [28, 14], rotate: false },   // 32*3=96
            2: { key: 'l2-enemy-medium', anim: 'l2-enemy-medium-fly', scale: 1.8, size: [40, 40], rotate: false }, // 48*1.8=86
            3: { key: 'l3-enemy-medium', anim: 'l3-enemy-medium-fly', scale: 0.85, size: [75, 75], rotate: false } // 101*0.85=86
        };
        const s = this.usesFinalAssetStyle()
            ? { key: 'final-enemy-medium', anim: null, scale: 1.8, size: [30, 32], rotate: false }
            : (sprites[Math.min(this.level, 3)] || sprites[1]);

        const enemy = this.enemies.create(x, -30, s.key);
        enemy.setScale(s.scale);
        if (s.rotate) enemy.setAngle(90); // Rotate side-facing sprites to face down
        if (s.anim) enemy.play(s.anim);
        enemy.setSize(s.size[0], s.size[1]);
        enemy.enemyType = 'medium';
        const overdrive = Math.max(0, this.level - 3);
        enemy.health = 2 + Math.floor(overdrive / 2) + (this.usesFinalAssetStyle() ? 1 : 0);
        if (this.isFinalLevel()) enemy.health = 2;
        enemy.points = 200 + overdrive * 50 + (this.usesFinalAssetStyle() ? 125 : 0);
        enemy.canShoot = this.isFinalLevel()
            ? Math.random() < 0.55
            : (this.level === 4 ? Math.random() < 0.68 : true);
        enemy.lastShot = 0;
        let minDelay = Math.max(420, (this.level >= 3 ? 700 : 800 - this.level * 100) - overdrive * 60);
        let maxDelay = Math.max(minDelay + 220, (this.level >= 3 ? 1400 : 1500 - this.level * 150) - overdrive * 90);
        if (this.level === 4) {
            minDelay += 360;
            maxDelay += 420;
        }
        if (this.isFinalLevel()) {
            minDelay += 520;
            maxDelay += 620;
        }
        enemy.shootDelay = Phaser.Math.Between(minDelay, maxDelay);
        enemy.setVelocityY(Phaser.Math.Between(80 + overdrive * 8, 140 + overdrive * 14));
        enemy.setVelocityX(Phaser.Math.Between(-40 - overdrive * 10, 40 + overdrive * 10));

        // Wobble movement for stage 2+
        if (this.level >= 2) {
            enemy.wobble = true;
            enemy.wobblePhase = Math.random() * Math.PI * 2;
            enemy.wobbleSpeed = Phaser.Math.Between(3 + overdrive, 5 + overdrive);
            enemy.wobbleAmount = Phaser.Math.Between(40, 70 + overdrive * 12);
        }
    }

    createBigEnemy(x) {
        // Level-specific sprites - normalized to ~80px display size
        const sprites = {
            1: { key: 'enemy-big', anim: 'enemy-big-fly', scale: 2.5, size: [28, 28] },     // 32*2.5=80
            2: { key: 'l2-enemy-big', anim: 'l2-enemy-big-fly', scale: 1.7, size: [40, 40] }, // 48*1.7=82
            3: { key: 'l3-enemy-big', anim: 'l3-enemy-big-fly', scale: 1.7, size: [40, 40], rotate: false } // 48*1.7=82
        };
        const s = this.usesFinalAssetStyle()
            ? { key: 'final-enemy-big', anim: null, scale: 2.1, size: [32, 34], rotate: false }
            : (sprites[Math.min(this.level, 3)] || sprites[1]);

        const enemy = this.enemies.create(x, -50, s.key);
        enemy.setScale(s.scale);
        if (s.rotate) enemy.setAngle(90); // Rotate side-facing sprites to face down
        if (s.anim) enemy.play(s.anim);
        enemy.setSize(s.size[0], s.size[1]);
        enemy.enemyType = 'big';
        const overdrive = Math.max(0, this.level - 3);
        enemy.health = 3 + this.level + overdrive + (this.usesFinalAssetStyle() ? 2 : 0);
        if (this.level === 4) enemy.health = 7;
        if (this.isFinalLevel()) enemy.health = 5;
        enemy.points = 500 + overdrive * 150 + (this.usesFinalAssetStyle() ? 250 : 0);
        enemy.canShoot = this.isFinalLevel()
            ? Math.random() < 0.7
            : (this.level === 4 ? Math.random() < 0.82 : true);
        enemy.lastShot = 0;
        enemy.shootDelay = this.level >= 3
            ? Phaser.Math.Between(Math.max(420, 700 - overdrive * 80), Math.max(760, 1200 - overdrive * 100))
            : Phaser.Math.Between(500, 1000);
        if (this.level === 4) enemy.shootDelay += 480;
        if (this.isFinalLevel()) enemy.shootDelay += 620;
        enemy.setVelocityY(Phaser.Math.Between(50 + overdrive * 8, 90 + overdrive * 12));
        enemy.trackPlayer = true;

        if (this.level >= 3) {
            enemy.erraticSpeed = true;
            enemy.nextSpeedChange = 0;
        }
    }

    updateEnemies(time) {
        this.enemies.getChildren().forEach(enemy => {
            // Skip if enemy was destroyed
            if (!enemy || !enemy.active) return;

            if (enemy.y > 680) {
                enemy.destroy();
                return;
            }

            if (enemy.canShoot && time > enemy.lastShot + enemy.shootDelay) {
                this.enemyShoot(enemy);
                enemy.lastShot = time;
            }

            if (enemy.trackPlayer && this.player && this.player.active) {
                const dx = this.player.x - enemy.x;
                enemy.setVelocityX(dx * 0.5);
            }

            // Wobble movement for medium enemies (stage 2+)
            if (enemy.wobble) {
                enemy.wobblePhase += 0.05 * enemy.wobbleSpeed;
                const wobbleX = Math.sin(enemy.wobblePhase) * enemy.wobbleAmount;
                enemy.setVelocityX(wobbleX);
            }

            // Erratic speed bursts for big enemies (stage 3)
            if (enemy.erraticSpeed && time > enemy.nextSpeedChange) {
                const burst = Phaser.Math.Between(0, 1) === 0;
                const overdrive = Math.max(0, this.level - 3);
                enemy.setVelocityY(
                    burst
                        ? Phaser.Math.Between(120 + overdrive * 20, 180 + overdrive * 24)
                        : Phaser.Math.Between(40 + overdrive * 8, 70 + overdrive * 10)
                );
                enemy.nextSpeedChange = time + Phaser.Math.Between(Math.max(240, 400 - overdrive * 40), 1000);
            }
        });
    }

    enemyShoot(enemy) {
        // Safety check
        if (!enemy || !enemy.active || !this.player || !this.player.active) return;

        const bullet = this.usesFinalAssetStyle()
            ? this.enemyBullets.create(enemy.x, enemy.y + 20, 'final-enemy-bullet-1')
            : this.enemyBullets.create(enemy.x, enemy.y + 20, 'laser', 2);
        bullet.setScale(this.usesFinalAssetStyle() ? 2.25 : 2);
        if (this.usesFinalAssetStyle()) {
            bullet.play('final-enemy-bullet-spin');
            bullet.body.setSize(14, 14);
        } else {
            bullet.setTint(0xff0000);
        }
        const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
        const bulletSpeed = Math.min(330, 200 + Math.max(0, this.level - 1) * 18);
        bullet.setVelocity(Math.cos(angle) * bulletSpeed, Math.sin(angle) * bulletSpeed);
    }

    checkWaveComplete() {
        if (!this.waveInProgress) return;

        const spawnDone = !this.enemySpawnTimer ||
            this.enemySpawnTimer.getRepeatCount() === 0;
        const enemiesCleared = this.enemies.countActive() === 0;

        if (spawnDone && enemiesCleared) {
            this.waveInProgress = false;
            this.wave++;

            this.time.delayedCall(2000, () => {
                if (!this.isDead) this.startWave();
            });
        }
    }

    // ============== BOSS FIGHT ==============

    startBossFight() {
        this.bossActive = true;
        this.sendTelemetry('boss_phase', 'ai_scan');
        void askCopilot(this.snapshot('ai_scan'));

        this.announceText.setText('WARNING!\nBOSS APPROACHING');
        this.announceText.setFill('#ff0000');
        this.announceText.setAlpha(1);

        // Flash warning
        this.tweens.add({
            targets: this.announceText,
            alpha: { from: 1, to: 0.3 },
            duration: 200,
            yoyo: true,
            repeat: 5,
            onComplete: () => {
                this.announceText.setAlpha(0);
                this.announceText.setFill('#ffffff');
                this.spawnBoss();
            }
        });

        // Screen shake
        this.cameras.main.shake(500, 0.01);
    }

    spawnBoss() {
        // Clear the boss group first
        this.bossGroup.clear(true, true);

        // Level-specific boss configuration
        const bossConfigs = {
            1: {
                key: 'boss',
                anim: 'boss-idle',
                scale: 1.2,
                hitbox: { w: 160, h: 100, ox: 16, oy: 22 }
            },
            2: {
                key: 'lvl2-boss',
                anim: null,
                scale: 0.86,
                hitbox: { w: 185, h: 175, ox: 32, oy: 36 }
            },
            3: {
                key: 'lvl3-boss',
                anim: null,
                scale: 0.44,
                hitbox: { w: 415, h: 326, ox: 80, oy: 61 }
            },
            4: {
                key: 'final-enemy-boss',
                anim: 'final-enemy-pulse',
                scale: 4.3,
                hitbox: { w: 38, h: 38, ox: 5, oy: 5 }
            }
        };
        const bossType = this.usesFinalAssetStyle() ? 4 : Math.min(this.level, 3);
        const config = bossConfigs[bossType] || bossConfigs[1];

        // Create boss and add to dedicated boss group
        this.boss = this.bossGroup.create(240, -100, config.key);
        this.boss.setScale(config.scale);
        if (config.anim) {
            this.boss.play(config.anim);
        }
        this.boss.setDepth(5);

        // Store boss type for later reference
        this.boss.bossType = bossType;
        this.boss.bossTier = this.level;

        const overdrive = Math.max(0, this.level - 3);
        this.bossMaxHP = 1000 + (this.level - 1) * 220 + overdrive * 280 + (this.usesFinalAssetStyle() ? 600 : 0);
        if (this.isFinalLevel()) {
            this.bossMaxHP = Math.floor(this.bossMaxHP * 0.62);
        }
        this.bossHP = this.bossMaxHP;
        this.boss.points = 5000 * this.level;
        this.boss.lastShot = 0; // Will be set properly when active

        // Mark this sprite as THE boss so we can identify it even if this.boss reference is lost
        this.boss.isBossSprite = true;

        this.boss.shootPattern = 0;
        this.boss.phaseTime = 0;

        // Set hitbox based on boss config
        this.boss.body.setSize(config.hitbox.w, config.hitbox.h);
        this.boss.body.setOffset(config.hitbox.ox, config.hitbox.oy);

        // Boss is invincible during entry
        this.boss.isEntering = true;

        // Reset boss health bar to full
        this.bossHealthBar.setScale(1, 1);

        // Enter animation
        this.tweens.add({
            targets: this.boss,
            y: 120,
            duration: 2000,
            ease: 'Power2',
            onComplete: () => {
                // NOW enable collisions after boss is visible - use bossGroup for clean collision handling
                this.bossCollider = this.physics.add.overlap(this.bullets, this.bossGroup, this.hitBoss, null, this);
                this.bossPlayerCollider = this.physics.add.overlap(this.player, this.bossGroup, this.playerHitByEnemy, null, this);

                this.bossHealthContainer.setVisible(true);
                this.boss.isEntering = false;
                this.boss.movementPhase = 'active';

                // Initialize lastShot to current time so boss shoots after first delay
                this.boss.lastShot = this.time.now;

                // Fire immediately on entry!
                this.bossShoot();
            }
        });
    }

    updateBoss(time) {
        if (!this.boss || !this.boss.active) return;
        if (this.boss.movementPhase !== 'active') return;

        // Movement pattern
        this.boss.phaseTime += 16;
        const bossTier = this.boss.bossTier || this.boss.bossType || 1;
        const overdrive = Math.max(0, bossTier - 3);
        const moveX = Math.sin(this.boss.phaseTime * (0.002 + overdrive * 0.00035)) * (100 + overdrive * 18);
        this.boss.x = 240 + moveX;

        // Shooting patterns based on health
        // Use scene-level HP variables
        const healthPercent = this.bossHP / this.bossMaxHP;
        const bossType = this.boss.bossType || 1;
        let shootDelay = 600;

        if (bossType === 1) {
            // Boss 1: Easy - no phase changes, consistent speed
            shootDelay = 700;
            this.boss.shootPattern = 0;
        } else {
            // Boss 2 & 3: Progressive difficulty with phases
            if (healthPercent < 0.3) {
                shootDelay = Math.max(170, 300 - overdrive * 35);
                this.boss.shootPattern = 2;
            } else if (healthPercent < 0.6) {
                shootDelay = Math.max(240, 450 - overdrive * 45);
                this.boss.shootPattern = 1;
            } else {
                shootDelay = Math.max(340, 600 - overdrive * 55);
                this.boss.shootPattern = 0;
            }
        }
        if (bossType === 4) {
            shootDelay += bossTier >= this.maxLevel ? 480 : 360;
        }

        if (time > this.boss.lastShot + shootDelay) {
            this.bossShoot();
            this.boss.lastShot = time;
        }

        // Update damage visual feedback
        if (this.boss.bossType === 1) {
            // Original boss has damage frames
            if (healthPercent < 0.3) {
                this.boss.play('boss-damage-3', true);
            } else if (healthPercent < 0.6) {
                this.boss.play('boss-damage-2', true);
            } else if (healthPercent < 0.85) {
                this.boss.play('boss-damage-1', true);
            }
        } else {
            // Other bosses use tint for damage feedback
            if (healthPercent < 0.3) {
                this.boss.setTint(0xff0000); // Red when critical
            } else if (healthPercent < 0.6) {
                this.boss.setTint(0xff8800); // Orange when damaged
            } else {
                this.boss.clearTint(); // Normal
            }
        }
    }

    bossShoot() {
        const bossType = this.boss.bossType || 1;
        const bossTier = this.boss.bossTier || bossType;
        const overdrive = Math.max(0, bossTier - 3);

        if (bossType === 1) {
            // BOSS 1: Original - Simple attacks, no intense phases
            // Only uses pattern 0 (simple spread)
            for (let i = -1; i <= 1; i++) {
                const bullet = this.enemyBullets.create(this.boss.x + i * 40, this.boss.y + 60, 'laser', 2);
                bullet.setScale(2);
                bullet.setTint(0xff0000);
                bullet.setVelocity(i * 60, 200);
            }
        } else if (bossType === 2) {
            // BOSS 2: Fire Skull - Fireballs with varying patterns
            if (this.boss.shootPattern === 0) {
                // Wide fire spread (5 bullets in arc)
                for (let i = -2; i <= 2; i++) {
                    const bullet = this.enemyBullets.create(this.boss.x, this.boss.y + 60, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0xff6600);
                    bullet.setVelocity(i * 70, 180);
                }
            } else if (this.boss.shootPattern === 1) {
                // Homing fireballs (3 that track player)
                for (let i = -1; i <= 1; i++) {
                    const bullet = this.enemyBullets.create(this.boss.x + i * 60, this.boss.y + 50, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0xff4400);
                    const angle = Phaser.Math.Angle.Between(bullet.x, bullet.y, this.player.x, this.player.y);
                    bullet.setVelocity(Math.cos(angle) * 200, Math.sin(angle) * 200);
                }
            } else {
                // Fire rain - random fireballs dropping
                for (let i = 0; i < 5; i++) {
                    const x = this.boss.x + Phaser.Math.Between(-100, 100);
                    const bullet = this.enemyBullets.create(x, this.boss.y + 40, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0xff2200);
                    bullet.setVelocity(Phaser.Math.Between(-30, 30), Phaser.Math.Between(200, 280));
                }
            }
        } else if (bossType === 3) {
            // BOSS 3: Demon - Blue fire breath and dark magic attacks
            if (this.boss.shootPattern === 0) {
                // Blue fire breath - wide spreading flames
                for (let i = -3 - overdrive; i <= 3 + overdrive; i++) {
                    const bullet = this.enemyBullets.create(this.boss.x + i * 25, this.boss.y + 80, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0x00ccff); // Blue fire
                    bullet.setVelocity(i * 60, 200 + overdrive * 20);
                }
            } else if (this.boss.shootPattern === 1) {
                // Dark orbs - homing projectiles from wings
                for (let i = -1 - Math.min(overdrive, 1); i <= 1 + Math.min(overdrive, 1); i++) {
                    const bullet = this.enemyBullets.create(this.boss.x + i * 80, this.boss.y + 40, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0x8800ff); // Purple dark magic
                    const angle = Phaser.Math.Angle.Between(bullet.x, bullet.y, this.player.x, this.player.y);
                    const speed = 220 + overdrive * 25;
                    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
                }
            } else {
                // Demon fury - spiral fire + rain of flames
                const bulletCount = 10 + overdrive * 3;
                for (let i = 0; i < bulletCount; i++) {
                    const angle = (this.boss.phaseTime * (0.025 + overdrive * 0.002)) + (i * Math.PI / 5);
                    const bullet = this.enemyBullets.create(this.boss.x, this.boss.y + 60, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0x00aaff); // Blue flames
                    bullet.setVelocity(Math.cos(angle) * (180 + overdrive * 18), Math.sin(angle) * (180 + overdrive * 18) + 100);
                }
            }

            if (overdrive > 0) {
                for (let i = 0; i < overdrive; i++) {
                    const bullet = this.enemyBullets.create(this.boss.x + Phaser.Math.Between(-120, 120), this.boss.y + 60, 'laser', 2);
                    bullet.setScale(2);
                    bullet.setTint(0xffdd00);
                    const angle = Phaser.Math.Angle.Between(bullet.x, bullet.y, this.player.x, this.player.y);
                    const speed = 230 + overdrive * 20;
                    bullet.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
                }
            }
        } else if (bossType === 4) {
            const createFinalBossBullet = (x, y, velocityX, velocityY) => {
                const bullet = this.enemyBullets.create(x, y, 'final-enemy-bullet-1');
                bullet.setScale(2.35);
                bullet.body.setSize(14, 14);
                bullet.play('final-enemy-bullet-spin');
                bullet.setVelocity(velocityX, velocityY);
                return bullet;
            };

            if (this.boss.shootPattern === 0) {
                const spread = bossTier >= this.maxLevel ? 1 : 2;
                for (let i = -spread; i <= spread; i++) {
                    createFinalBossBullet(this.boss.x + i * 24, this.boss.y + 50, i * 46, 190 + Math.abs(i) * 8);
                }
            } else if (this.boss.shootPattern === 1) {
                const spread = 1;
                for (let i = -spread; i <= spread; i++) {
                    const x = this.boss.x + i * 52;
                    const y = this.boss.y + 42;
                    const angle = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
                    createFinalBossBullet(x, y, Math.cos(angle) * 215, Math.sin(angle) * 215);
                }
            } else {
                const bulletCount = bossTier >= this.maxLevel ? 6 : 8;
                for (let i = 0; i < bulletCount; i++) {
                    const angle = (this.boss.phaseTime * (bossTier >= this.maxLevel ? 0.018 : 0.028)) + (i * Math.PI * 2 / bulletCount);
                    createFinalBossBullet(
                        this.boss.x,
                        this.boss.y + 45,
                        Math.cos(angle) * 170,
                        Math.sin(angle) * 170 + 80
                    );
                }
            }
        }
    }

    hitBoss(bullet, boss) {
        // Safety check - make sure boss exists and is valid
        if (!boss || !boss.active || !this.bossActive) {
            bullet.destroy();
            return;
        }

        // Piercing bullets don't get destroyed but track hits
        if (bullet.isPiercing) {
            if (!bullet.hitBoss) bullet.hitBoss = false;
            if (bullet.hitBoss) return; // Already hit boss this pass
            bullet.hitBoss = true;
            // Reset after a short delay so it can hit again if still in contact
            this.time.delayedCall(200, () => {
                if (bullet.active) bullet.hitBoss = false;
            });
        } else {
            bullet.destroy();
        }

        // Each bullet does 10 damage (fireballs do 5 vs boss since they pierce)
        const damage = bullet.isPiercing ? 5 : 10;
        this.bossHP = Math.max(0, this.bossHP - damage);

        // Update health bar using scene-level HP
        const healthPercent = this.bossHP / this.bossMaxHP;
        this.bossHealthBar.setScale(Math.max(0, healthPercent), 1);

        // Change health bar color based on health
        if (healthPercent < 0.3) {
            this.bossHealthBar.setFillStyle(0xff0000); // Red when critical
        } else if (healthPercent < 0.6) {
            this.bossHealthBar.setFillStyle(0xff8800); // Orange when damaged
        }

        // Flash effect
        boss.setTint(0xffffff);
        this.time.delayedCall(50, () => {
            const tints = [0xffffff, 0x8888ff, 0xffdd00];
            if (boss && boss.active) boss.setTint(tints[Math.min(this.level, 3) - 1]);
        });

        // Only defeat boss when health reaches 0 - use SCENE-LEVEL HP
        if (this.bossHP <= 0 && this.bossActive) {
            this.defeatBoss();
        }
    }

    defeatBoss() {
        // Prevent multiple calls
        if (!this.bossActive) {
            return;
        }

        this.bossActive = false;
        this.bossHealthContainer.setVisible(false);

        // Remove colliders safely
        if (this.bossCollider) {
            this.bossCollider.destroy();
            this.bossCollider = null;
        }
        if (this.bossPlayerCollider) {
            this.bossPlayerCollider.destroy();
            this.bossPlayerCollider = null;
        }

        // Store boss position for explosions
        const bossX = this.boss ? this.boss.x : 240;
        const bossY = this.boss ? this.boss.y : 120;
        const bossPoints = 5000 * this.level;

        // Hide boss immediately
        if (this.boss) {
            this.boss.setVisible(false);
            if (this.boss.body) this.boss.body.enable = false;
        }

        // Multiple explosions
        for (let i = 0; i < 8; i++) {
            this.time.delayedCall(i * 200, () => {
                const x = bossX + Phaser.Math.Between(-80, 80);
                const y = bossY + Phaser.Math.Between(-60, 60);
                this.createExplosion(x, y, 'boss');
                this.cameras.main.shake(100, 0.02);
            });
        }

        // Final big explosion and level complete
        this.time.delayedCall(1600, () => {
            this.createExplosion(bossX, bossY, 'boss');
            this.createExplosion(bossX - 40, bossY - 20, 'boss');
            this.createExplosion(bossX + 40, bossY + 20, 'boss');
            this.cameras.main.shake(300, 0.03);

            this.score += bossPoints;
            this.scoreText.setText('SCORE: ' + this.score);
            this.sendTelemetry('boss_phase', 'ai_scan');

            // Clear boss group and reference
            this.bossGroup.clear(true, true);
            this.boss = null;

            // Level complete after short delay
            this.time.delayedCall(1500, () => this.levelComplete());
        });
    }

    setGameplayUiVisible(visible) {
        [
            this.scoreText,
            this.levelText,
            this.livesIcon,
            this.livesText,
            this.healthBarBg,
            this.healthBar,
            this.healthBorder,
            this.oracleLogo
        ].forEach(item => {
            if (item) item.setVisible(visible);
        });

        if (this.bossHealthContainer) {
            this.bossHealthContainer.setVisible(
                visible &&
                this.bossActive &&
                this.boss &&
                this.boss.movementPhase === 'active'
            );
        }
    }

    clearStageForBriefing() {
        if (this.enemySpawnTimer) {
            this.enemySpawnTimer.remove();
            this.enemySpawnTimer = null;
        }

        if (this.bossCollider) {
            this.bossCollider.destroy();
            this.bossCollider = null;
        }
        if (this.bossPlayerCollider) {
            this.bossPlayerCollider.destroy();
            this.bossPlayerCollider = null;
        }

        this.bullets.clear(true, true);
        this.enemyBullets.clear(true, true);
        this.enemies.clear(true, true);
        this.powerups.clear(true, true);
        this.bossGroup.clear(true, true);

        this.boss = null;
        this.bossActive = false;
        this.waveInProgress = false;
        this.touchPointer = null;

        this.announceText.setAlpha(0);
        this.shieldActive = false;
        this.shieldSprite.clear();
        this.setGameplayUiVisible(false);

        if (this.player) {
            this.player.setVisible(false);
            this.player.setVelocity(0, 0);
            if (this.player.body) this.player.body.enable = false;
        }
    }

    restoreStageAfterOverlay() {
        this.setGameplayUiVisible(true);
        this.educationOverlayActive = false;

        if (this.player) {
            this.player.setVisible(true);
            this.player.setVelocity(0, 0);
            if (this.player.body) this.player.body.enable = true;
        }
    }

    showEducationOverlay(level, onDone) {
        const briefing = BRIEFINGS_BY_LEVEL[level];
        if (!briefing) {
            onDone();
            return;
        }

        this.educationOverlayActive = true;
        this.clearStageForBriefing();

        const overlay = this.add.container(0, 0).setDepth(1000).setAlpha(0);
        const height = this.scale.height;
        const extraY = Math.max(0, height - 640);
        const textMaskHeight = 292 + extraY;
        const textStartY = 562 + extraY;
        const buttonY = 612 + extraY;
        let finished = false;
        let briefingReady = false;
        const blocker = this.add.rectangle(240, height / 2, 480, height, 0x030814, 0.82)
            .setInteractive();
        const linearTextureFilter = Phaser.Textures?.FilterMode?.LINEAR;
        if (linearTextureFilter !== undefined) {
            this.textures.get(briefing.imageKey)?.setFilter?.(linearTextureFilter);
        }
        const briefingImage = this.add.image(240, 164, briefing.imageKey)
            .setDisplaySize(408, 189);
        const title = this.add.text(240, 28, briefing.title, {
            fontFamily: 'monospace',
            fontSize: '21px',
            fill: '#ffffff',
            stroke: '#062031',
            strokeThickness: 5
        }).setOrigin(0.5);
        const subtitle = this.add.text(240, 55, 'MISSION BRIEFING', {
            fontFamily: 'monospace',
            fontSize: '13px',
            fill: '#d7dde5',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);

        const guide = this.add.image(82, 478 + extraY, briefing.guideKey)
            .setDisplaySize(164, 164);
        const nameplate = this.add.rectangle(82, 580 + extraY, 158, 32, 0x06111c, 0.8);
        const guideLabel = this.add.text(82, 580 + extraY, 'OCI GUIDE', {
            fontFamily: 'monospace',
            fontSize: '13px',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);

        const textMaskShape = this.add.graphics();
        textMaskShape.fillStyle(0xffffff, 1);
        textMaskShape.fillRect(154, 270, 304, textMaskHeight);
        textMaskShape.setVisible(false);
        const textMask = textMaskShape.createGeometryMask();
        const bodyText = this.add.text(162, textStartY, briefing.lines.join('\n\n'), {
            fontFamily: 'monospace',
            fontSize: '12px',
            fill: '#d9faff',
            stroke: '#000000',
            strokeThickness: 2,
            lineSpacing: 5,
            wordWrap: { width: 288 }
        }).setMask(textMask);
        const replayButton = this.add.rectangle(154, buttonY, 116, 34, 0x12384a, 0.95)
            .setInteractive({ useHandCursor: true });
        const replayText = this.add.text(154, buttonY, 'REPLAY', {
            fontFamily: 'monospace',
            fontSize: '13px',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);
        const continueButton = this.add.rectangle(344, buttonY, 136, 34, 0x4a4a4a, 0.72)
            .setInteractive({ useHandCursor: true });
        const continueText = this.add.text(344, buttonY, 'CONTINUE', {
            fontFamily: 'monospace',
            fontSize: '14px',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setAlpha(0.55);

        overlay.add([
            blocker,
            textMaskShape,
            briefingImage,
            title,
            subtitle,
            guide,
            nameplate,
            guideLabel,
            bodyText,
            replayButton,
            replayText,
            continueButton,
            continueText
        ]);

        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: 450,
            ease: 'Power2'
        });
        let scrollTween = null;

        const setContinueReady = (ready) => {
            briefingReady = ready;
            continueButton.setFillStyle(ready ? 0xc74634 : 0x4a4a4a, ready ? 0.95 : 0.72);
            continueText.setAlpha(ready ? 1 : 0.55);
        };

        const startScroll = () => {
            if (scrollTween) scrollTween.stop();
            bodyText.setY(textStartY);
            setContinueReady(false);
            scrollTween = this.tweens.add({
                targets: bodyText,
                y: 274 - bodyText.height,
                duration: briefing.durationMs,
                ease: 'Linear',
                onComplete: () => setContinueReady(true)
            });
        };

        startScroll();

        const finishBriefing = () => {
            if (finished || !briefingReady) return;
            finished = true;
            if (scrollTween) scrollTween.stop();
            this.input.keyboard.off('keydown-SPACE', handleBriefingKey);
            this.input.keyboard.off('keydown-ENTER', handleBriefingKey);
            this.tweens.add({
                targets: overlay,
                alpha: 0,
                duration: 450,
                ease: 'Power2',
                onComplete: () => {
                    overlay.destroy(true);
                    this.educationOverlayActive = false;
                    onDone();
                }
            });
        };

        const handleBriefingKey = () => finishBriefing();
        continueButton.on('pointerover', () => {
            if (briefingReady) continueButton.setFillStyle(0xf15d4a, 1);
        });
        continueButton.on('pointerout', () => {
            continueButton.setFillStyle(briefingReady ? 0xc74634 : 0x4a4a4a, briefingReady ? 0.95 : 0.72);
        });
        continueButton.on('pointerdown', finishBriefing);
        replayButton.on('pointerover', () => replayButton.setFillStyle(0x1c536d, 1));
        replayButton.on('pointerout', () => replayButton.setFillStyle(0x12384a, 0.95));
        replayButton.on('pointerdown', startScroll);
        this.input.keyboard.on('keydown-SPACE', handleBriefingKey);
        this.input.keyboard.on('keydown-ENTER', handleBriefingKey);
    }

    createCoachPanel(question, statusText) {
        const root = document.getElementById('gameRoot');
        if (!root) return null;

        const panel = document.createElement('div');
        panel.className = 'game-coach-panel';
        panel.innerHTML = `
            <div class="game-coach-title">OCI Guide</div>
            <div class="game-coach-question" data-coach-question>Ask a question below.</div>
            <div class="game-coach-row">
                <input
                    data-coach-input
                    maxlength="300"
                    placeholder="Ask for a hint..."
                    autocomplete="off"
                    autocapitalize="sentences"
                    autocorrect="off"
                    spellcheck="false"
                    inputmode="text"
                    aria-label="Ask OCI Guide for a hint"
                />
                <button type="button" data-coach-send>Ask</button>
            </div>
        `;
        root.appendChild(panel);

        const questionText = panel.querySelector('[data-coach-question]');
        const input = panel.querySelector('[data-coach-input]');
        const send = panel.querySelector('[data-coach-send]');
        let busy = false;
        let destroyed = false;
        const keyboard = this.input?.keyboard;
        let keyboardWasEnabled = keyboard?.enabled ?? true;
        const stopGameInput = (event) => {
            event.stopPropagation();
        };
        const pauseGameKeyboard = () => {
            keyboardWasEnabled = keyboard?.enabled ?? true;
            if (keyboard) keyboard.enabled = false;
        };
        const resumeGameKeyboard = () => {
            if (keyboard) keyboard.enabled = keyboardWasEnabled;
        };
        const stopTypingFromReachingGame = (event) => {
            event.stopPropagation();
        };
        const submitCoachQuestion = () => {
            if (busy) return;
            const message = input.value.trim() || 'Can you give me a hint?';
            input.value = '';
            void ask(message, this.quizAttemptCount);
        };
        const handleCoachSubmit = (event) => {
            event.preventDefault();
            event.stopPropagation();
            submitCoachQuestion();
        };

        const ask = async (message, attemptCount) => {
            if (busy) return;
            busy = true;
            send.disabled = true;
            const shouldRefocus = document.activeElement === input;
            questionText.textContent = message;
            statusText.setText('OCI GUIDE IS THINKING...');

            const result = await askCoach({
                level: this.level,
                questionId: question.id,
                message,
                attemptCount
            });
            if (destroyed) return;
            statusText.setText(result.reply.toUpperCase());
            busy = false;
            send.disabled = false;
            if (shouldRefocus) {
                input.focus({ preventScroll: true });
            }
        };

        panel.addEventListener('pointerdown', stopGameInput);
        panel.addEventListener('mousedown', stopGameInput);
        panel.addEventListener('touchstart', stopGameInput, { passive: true });
        input.addEventListener('focus', () => {
            document.body.classList.add('coach-input-active');
            panel.classList.add('is-editing');
            pauseGameKeyboard();
            window.OCI_DEFENSE_LAYOUT_CHANGED?.();
        });
        input.addEventListener('blur', () => {
            document.body.classList.remove('coach-input-active');
            panel.classList.remove('is-editing');
            resumeGameKeyboard();
            window.OCI_DEFENSE_LAYOUT_CHANGED?.();
        });
        send.addEventListener('pointerdown', handleCoachSubmit);
        send.addEventListener('mousedown', handleCoachSubmit);
        send.addEventListener('touchend', handleCoachSubmit);
        send.addEventListener('click', handleCoachSubmit);
        ['keydown', 'keyup', 'keypress'].forEach((eventName) => {
            input.addEventListener(eventName, stopTypingFromReachingGame, true);
            input.addEventListener(eventName, stopTypingFromReachingGame);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                submitCoachQuestion();
            }
        });

        return {
            element: panel,
            ask,
            destroy() {
                destroyed = true;
                document.body.classList.remove('coach-input-active');
                resumeGameKeyboard();
                panel.remove();
            }
        };
    }

    showQuizOverlay(level, onDone) {
        const question = QUIZ_BY_LEVEL[level];
        if (!question) {
            onDone();
            return;
        }

        this.educationOverlayActive = true;
        this.quizAttemptCount = 0;
        this.clearStageForBriefing();

        const overlay = this.add.container(0, 0).setDepth(1010).setAlpha(0);
        const height = this.scale.height;
        const extraY = Math.max(0, height - 640);
        const desktopLayout = height <= 680;
        const tallLayout = height > 720;
        const titleY = desktopLayout ? 34 : tallLayout ? 48 : 36;
        const subtitleY = desktopLayout ? 62 : tallLayout ? 82 : 66;
        const promptY = desktopLayout ? 96 : tallLayout ? 128 : 100;
        const continueY = Math.min(594 + extraY, height - 46);
        const blocker = this.add.rectangle(240, height / 2, 480, height, 0x030814, 0.9).setInteractive();
        const title = this.add.text(240, titleY, question.title, {
            fontFamily: 'monospace',
            fontSize: '24px',
            fill: '#ffffff',
            stroke: '#062031',
            strokeThickness: 5
        }).setOrigin(0.5);
        const subtitle = this.add.text(240, subtitleY, 'UNLOCK NEXT LEVEL', {
            fontFamily: 'monospace',
            fontSize: '12px',
            fill: '#7cc8ff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);
        const prompt = this.add.text(48, promptY, question.prompt, {
            fontFamily: 'monospace',
            fontSize: desktopLayout ? '15px' : '18px',
            fontStyle: 'bold',
            fill: '#d9faff',
            stroke: '#000000',
            strokeThickness: desktopLayout ? 3 : 4,
            lineSpacing: desktopLayout ? 3 : 5,
            wordWrap: { width: desktopLayout ? 392 : 384 }
        });
        const optionGap = desktopLayout ? 72 : tallLayout ? 90 : 84;
        const optionHeight = desktopLayout ? 60 : tallLayout ? 78 : 70;
        const optionLabelOffsetY = desktopLayout ? 22 : tallLayout ? 29 : 27;
        const promptBottom = prompt.y + prompt.height;
        const optionStartY = tallLayout
            ? 266
            : desktopLayout
                ? Math.max(220, promptBottom + optionHeight / 2 + 20)
                : Math.max(260, promptBottom + optionHeight / 2 + 28);
        const lastOptionY = optionStartY + optionGap * (question.options.length - 1);
        const answerY = tallLayout
            ? Math.min(optionStartY + optionGap * 3 + 74, height - 300)
            : desktopLayout
                ? Math.min(lastOptionY + optionHeight / 2 + 28, height - 162)
                : Math.min(lastOptionY + optionHeight / 2 + 58, height - 120);
        const guideY = tallLayout
            ? Math.min(answerY + 112, height - 198)
            : desktopLayout
                ? Math.min(answerY + 92, height - 96)
                : Math.min(answerY + 84, height - 116);
        const guideSize = desktopLayout ? 140 : 170;
        const guide = this.add.image(82, guideY, 'briefing-storyteller').setDisplaySize(guideSize, guideSize);
        const statusText = this.add.text(desktopLayout ? 152 : 158, answerY, 'Choose the strongest OCI answer.', {
            fontFamily: 'monospace',
            fontSize: desktopLayout ? '12px' : '14px',
            fill: '#d9faff',
            stroke: '#000000',
            strokeThickness: desktopLayout ? 2 : 3,
            lineSpacing: desktopLayout ? 3 : 5,
            wordWrap: { width: desktopLayout ? 300 : 290 }
        });
        const continueButton = this.add.rectangle(330, continueY, 176, 42, 0xc74634, 0.95)
            .setInteractive({ useHandCursor: true })
            .setVisible(false);
        const continueText = this.add.text(330, continueY, 'CONTINUE', {
            fontFamily: 'monospace',
            fontSize: '15px',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setVisible(false);

        overlay.add([blocker, title, subtitle, prompt, guide, statusText, continueButton, continueText]);

        let finished = false;
        let correct = false;
        let coachPanel = null;

        question.options.forEach((option, index) => {
            const y = optionStartY + index * optionGap;
            const button = this.add.rectangle(240, y, 408, optionHeight, 0x102432, 0.94)
                .setStrokeStyle(1, 0x2e4450)
                .setInteractive({ useHandCursor: true });
            const label = this.add.text(58, y - optionLabelOffsetY, `${String.fromCharCode(65 + index)}. ${option}`, {
                fontFamily: 'monospace',
                fontSize: desktopLayout ? '12px' : '14px',
                fontStyle: 'bold',
                fill: '#ffffff',
                stroke: '#000000',
                strokeThickness: desktopLayout ? 2 : 3,
                lineSpacing: desktopLayout ? 2 : 4,
                wordWrap: { width: desktopLayout ? 358 : 350, useAdvancedWrap: true }
            });

            button.on('pointerover', () => {
                if (!correct) button.setFillStyle(0x17384b, 1);
            });
            button.on('pointerout', () => {
                if (!correct) button.setFillStyle(0x102432, 0.94);
            });
            button.on('pointerdown', () => {
                if (correct) return;
                this.quizAttemptCount++;

                if (index === question.correctIndex) {
                    correct = true;
                    button.setFillStyle(0x1c6f4a, 1);
                    button.setStrokeStyle(2, 0x3ddc97);
                    statusText.setText(question.explanation);
                    continueButton.setVisible(true);
                    continueText.setVisible(true);
                    coachPanel?.destroy();
                    coachPanel = null;
                    return;
                }

                button.setFillStyle(0x5a1e24, 1);
                button.setStrokeStyle(2, 0xff6b6b);
                statusText.setText('Not quite. Ask OCI Guide for a hint, then try again.');
                coachPanel ??= this.createCoachPanel(question, statusText);
                void coachPanel?.ask(`I chose ${String.fromCharCode(65 + index)}. Give me a hint without revealing the answer.`, this.quizAttemptCount);
            });

            overlay.add([button, label]);
        });

        const finishQuiz = () => {
            if (finished || !correct) return;
            finished = true;
            coachPanel?.destroy();
            this.tweens.add({
                targets: overlay,
                alpha: 0,
                duration: 420,
                ease: 'Power2',
                onComplete: () => {
                    overlay.destroy(true);
                    this.educationOverlayActive = false;
                    onDone();
                }
            });
        };

        continueButton.on('pointerover', () => continueButton.setFillStyle(0xf15d4a, 1));
        continueButton.on('pointerout', () => continueButton.setFillStyle(0xc74634, 0.95));
        continueButton.on('pointerdown', finishQuiz);

        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: 450,
            ease: 'Power2'
        });
    }

    goToNextStage(showLevelComplete = true) {
        if (this.level >= this.maxLevel) {
            // Game complete!
            this.music.stop();
            this.sendTelemetry('run_end');
            void telemetry.flush();
            this.scene.start('VictoryScene', {
                score: this.score,
                callsign: this.callsign,
                runId: telemetry.runId
            });
            return;
        }

        const startNextLevel = () => {
            this.scene.start('GameScene', {
                level: this.level + 1,
                score: this.score,
                weaponLevel: this.weaponLevel,
                callsign: this.callsign,
                lives: this.lives
            });
        };

        if (!showLevelComplete) {
            startNextLevel();
            return;
        }

        // Next level - music keeps playing until next stage loads
        this.announceText.setText('LEVEL COMPLETE!');
        this.announceText.setAlpha(1);
        this.time.delayedCall(2500, startNextLevel);
    }

    levelComplete() {

        // Save progress
        const bestLevel = parseInt(localStorage.getItem('bestLevel')) || 0;
        if (this.level > bestLevel) {
            localStorage.setItem('bestLevel', this.level);
        }

        if (QUIZ_BY_LEVEL[this.level]) {
            this.showQuizOverlay(this.level, () => this.goToNextStage(false));
            return;
        }

        this.goToNextStage(true);
    }

    // ============== COLLISIONS ==============

    hitEnemy(bullet, enemy) {
        // Safety check - skip if already destroyed
        if (!enemy || !enemy.active || !bullet || !bullet.active) return;

        // CRITICAL: Never process the boss through this function
        // Check both the flag AND if it's in the bossGroup
        if (enemy.isBossSprite || this.bossGroup.contains(enemy)) {
            console.warn('hitEnemy called with boss sprite! Redirecting to hitBoss.');
            // Don't destroy bullet here - let hitBoss handle it
            return;
        }

        // Piercing bullets don't get destroyed (but have cooldown per enemy)
        if (bullet.isPiercing) {
            // Track which enemies this bullet has hit
            if (!bullet.hitEnemies) bullet.hitEnemies = new Set();
            if (bullet.hitEnemies.has(enemy)) return; // Already hit this enemy
            bullet.hitEnemies.add(enemy);
        } else {
            bullet.destroy();
        }

        enemy.health--;

        if (enemy.health <= 0) {
            this.createExplosion(enemy.x, enemy.y, enemy.enemyType);
            this.maybeDropPowerup(enemy.x, enemy.y);
            this.score += enemy.points;
            this.scoreText.setText('SCORE: ' + this.score);
            this.sendTelemetry('enemy_killed', 'rebalance_lb');
            enemy.destroy();
        } else {
            enemy.setTint(0xff0000);
            this.time.delayedCall(100, () => {
                if (enemy.active) enemy.clearTint();
            });
        }
    }

    playerHitByEnemy(player, enemy) {
        // Safety check
        if (!enemy || !enemy.active || !player || !player.active) return;

        // Check if this is the boss - use multiple checks for safety
        const isBoss = (this.boss && enemy === this.boss) ||
                       enemy.isBossSprite === true ||
                       this.bossGroup.contains(enemy);

        if (this.isInvincible || this.shieldActive) {
            if (!isBoss && enemy.active) {
                this.createExplosion(enemy.x, enemy.y, enemy.enemyType || 'small');
                enemy.destroy();
            }
            return;
        }

        this.takeDamage(isBoss ? 30 : 50);
        if (!isBoss && enemy.active) {
            this.createExplosion(enemy.x, enemy.y, enemy.enemyType || 'small');
            enemy.destroy();
        }
    }

    playerHitByBullet(player, bullet) {
        if (this.isInvincible || this.shieldActive) {
            bullet.destroy();
            return;
        }
        this.takeDamage(20);
        bullet.destroy();
    }

    takeDamage(amount) {
        this.health -= amount;
        this.updateHealthBar();
        this.sendTelemetry('player_hit', 'shield');

        // Play hit sound
        this.sounds.hit.play();

        this.player.setTint(0xff0000);
        this.time.delayedCall(100, () => {
            if (this.player.active) this.player.clearTint();
        });

        this.cameras.main.shake(100, 0.01);

        if (this.health <= 0) this.loseLife();
    }

    updateHealthBar() {
        const pct = Math.max(0, this.health / this.maxHealth);
        this.healthBar.setScale(pct, 1);
        this.healthBar.setFillStyle(pct > 0.6 ? 0x00ff00 : pct > 0.3 ? 0xffff00 : 0xff0000);
    }

    loseLife() {
        this.lives--;
        this.livesText.setText(this.lives.toString());

        if (this.lives <= 0) {
            this.gameOver();
        } else {
            this.respawn();
        }
    }

    respawn() {
        this.health = this.maxHealth;
        this.updateHealthBar();
        this.createExplosion(this.player.x, this.player.y, 'big');

        this.player.setPosition(240, this.scale.height - 90);
        this.player.setVelocity(0, 0);

        this.isInvincible = true;
        this.tweens.add({
            targets: this.player,
            alpha: { from: 0.3, to: 0.8 },
            duration: 100,
            repeat: 15,
            yoyo: true,
            onComplete: () => {
                this.isInvincible = false;
                this.player.setAlpha(1);
            }
        });
    }

    gameOver() {
        this.isDead = true;
        this.createExplosion(this.player.x, this.player.y, 'big');
        this.sounds.playerDeath.play();
        this.music.stop();
        this.player.setVisible(false);
        this.player.body.enable = false;

        if (this.enemySpawnTimer) this.enemySpawnTimer.remove();

        // Save stats
        const highScore = parseInt(localStorage.getItem('highScore')) || 0;
        if (this.score > highScore) localStorage.setItem('highScore', this.score);

        const bestWave = parseInt(localStorage.getItem('bestWave')) || 0;
        const totalWave = (this.level - 1) * this.wavesPerLevel + this.wave;
        if (totalWave > bestWave) localStorage.setItem('bestWave', totalWave);
        this.sendTelemetry('run_end');
        void telemetry.flush();

        this.time.delayedCall(2000, () => {
            this.scene.start('GameOverScene', {
                score: this.score,
                level: this.level,
                wave: this.wave,
                callsign: this.callsign,
                runId: telemetry.runId
            });
        });
    }

    // ============== POWER-UPS ==============

    maybeDropPowerup(x, y) {
        // 20% drop rate
        if (Math.random() > 0.20) return;

        const weights = [0.30, 0.25, 0.20, 0.05, 0.20]; // weapon, shield, speed, life, fireball
        const types = ['weapon', 'shield', 'speed', 'life', 'fireball'];
        let rand = Math.random();
        let type = 'weapon';

        for (let i = 0; i < weights.length; i++) {
            if (rand < weights[i]) { type = types[i]; break; }
            rand -= weights[i];
        }

        const frameMap = { weapon: 0, shield: 1, speed: 2, life: 3, fireball: 0 };
        const powerup = this.powerups.create(x, y, 'powerup', frameMap[type]);
        powerup.setScale(1.4);
        powerup.powerupType = type;
        powerup.setVelocityY(80);

        this.tweens.add({
            targets: powerup,
            scale: { from: 1.4, to: 1.65 },
            duration: 300,
            yoyo: true,
            repeat: -1
        });
    }

    collectPowerup(player, powerup) {
        const type = powerup.powerupType;

        // Play powerup sound
        this.sounds.powerup.play();

        const messages = {
            weapon: ['WEAPON UP!', 0xff8800],
            shield: ['SHIELD!', 0x00ffff],
            speed: ['SPEED BOOST!', 0x00ff00],
            life: ['EXTRA LIFE!', 0xff00ff],
            fireball: ['FIREBALL!', 0xff4400]
        };

        if (type === 'weapon') this.weaponLevel = Math.min(this.weaponLevel + 1, 3);
        else if (type === 'shield') this.activateShield();
        else if (type === 'speed') this.activateSpeedBoost();
        else if (type === 'fireball') this.activateFireball();
        else if (type === 'life') {
            this.lives++;
            this.livesText.setText(this.lives.toString());
        }

        this.showPowerupText(messages[type][0], messages[type][1]);
        this.sendTelemetry('powerup', type === 'weapon' ? 'rebalance_lb' : 'ai_scan');
        if (type === 'life') {
            this.sendTelemetry('extra_life', 'ai_scan');
        }
        powerup.destroy();
    }

    activateShield() {
        this.shieldActive = true;
        if (this.shieldTimer) this.shieldTimer.remove();
        this.shieldTimer = this.time.delayedCall(5000, () => this.shieldActive = false);
    }

    activateSpeedBoost() {
        this.playerSpeedBoost = 1.5;
        if (this.speedBoostTimer) this.speedBoostTimer.remove();
        this.speedBoostTimer = this.time.delayedCall(5000, () => this.playerSpeedBoost = 1);
    }

    activateFireball() {
        this.fireballActive = true;
        if (this.fireballTimer) this.fireballTimer.remove();
        // Fireball lasts 8 seconds
        this.fireballTimer = this.time.delayedCall(8000, () => this.fireballActive = false);
    }

    showPowerupText(text, color) {
        const t = this.add.text(this.player.x, this.player.y - 50, text, {
            fontFamily: 'monospace', fontSize: '20px',
            fill: '#' + color.toString(16).padStart(6, '0'),
            stroke: '#000', strokeThickness: 4
        }).setOrigin(0.5).setDepth(100);

        this.tweens.add({
            targets: t, y: t.y - 50, alpha: 0, duration: 1000,
            onComplete: () => t.destroy()
        });
    }

    // ============== EXPLOSIONS & CLEANUP ==============

    createExplosion(x, y, type) {
        const config = this.usesFinalAssetStyle()
            ? {
                small: ['final-explosion', 'final-explode', 2.1],
                medium: ['final-explosion', 'final-explode', 2.8],
                big: ['final-explosion', 'final-explode', 3.3],
                boss: ['final-explosion', 'final-explode', 4.7]
            }
            : {
                small: ['explosion', 'explode', 4],
                medium: ['explosion-large', 'explode-large', 2.5],
                big: ['explosion-big', 'explode-big', 2],
                boss: ['explosion-boss', 'explode-boss', 1.5]
            };

        const [sprite, anim, scale] = config[type] || config.small;
        const explosion = this.add.sprite(x, y, sprite).setScale(scale).setDepth(50);
        explosion.play(anim);
        explosion.on('animationcomplete', () => explosion.destroy());

        // Play explosion sound
        this.sounds.explosion.play();

        if (type === 'big' || type === 'boss') {
            this.cameras.main.shake(200, 0.02);
        }
    }

    cleanupOffscreen() {
        this.bullets.getChildren().forEach(b => { if (b.y < -20) b.destroy(); });
        this.enemyBullets.getChildren().forEach(b => {
            if (b.y > 660 || b.y < -20 || b.x < -20 || b.x > 500) b.destroy();
        });
        this.powerups.getChildren().forEach(p => { if (p.y > 660) p.destroy(); });
    }

    snapshot(cloudAction = 'none') {
        return {
            score: this.score || 0,
            level: this.level || 1,
            callsign: this.callsign || 'UNKNOWN',
            cloudAction,
            fps: this.game?.loop?.actualFps || 60,
            wave: this.wave || 1,
            bossActive: this.bossActive === true
        };
    }

    sendTelemetry(type, cloudAction = 'none') {
        void emitGameEvent(type, this.snapshot(cloudAction));
    }

    updateOciHud(time) {
        if (time - this.lastOciHudUpdate < 250) return;
        this.lastOciHudUpdate = time;
        updateHud(this.snapshot());

        if (time - this.lastTelemetryHeartbeat > 5000) {
            this.lastTelemetryHeartbeat = time;
            this.sendTelemetry('heartbeat');
        }
    }
}
