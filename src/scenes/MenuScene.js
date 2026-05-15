export default class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        document.body.classList.remove('game-active');
        window.OCI_DEFENSE_LAYOUT_CHANGED?.();

        const width = this.cameras.main.width;
        this.callsign = this.normalizeCallsign(localStorage.getItem('playerCallsign') || '');
        this.setupCallsignControls();

        // Stop any previous music and start title music
        this.sound.stopAll();
        this.music = this.sound.add('music-title', { loop: true, volume: 0.5 });
        this.music.play();

        // Dynamic background. Later level backgrounds are lazy-loaded after launch.
        this.bgIndex = 0;
        this.backgrounds = ['background'];
        this.bg = this.add.image(240, 320, this.backgrounds[0])
            .setDisplaySize(480, 640);

        // Cycle backgrounds every 3 seconds
        this.time.addEvent({
            delay: 3000,
            callback: () => {
                if (this.backgrounds.length < 2) return;

                this.bgIndex = (this.bgIndex + 1) % this.backgrounds.length;
                this.tweens.add({
                    targets: this.bg,
                    alpha: 0,
                    duration: 500,
                    onComplete: () => {
                        this.bg.setTexture(this.backgrounds[this.bgIndex]);
                        this.tweens.add({
                            targets: this.bg,
                            alpha: 1,
                            duration: 500
                        });
                    }
                });
            },
            loop: true
        });

        // Scrolling stars layer
        this.stars = this.add.tileSprite(0, 0, 480, 640, 'stars')
            .setOrigin(0, 0)
            .setTileScale(2)
            .setAlpha(0.7);

        // Spawn animated enemies in background
        this.bgEnemies = [];
        this.time.addEvent({
            delay: 800,
            callback: () => this.spawnBackgroundEnemy(),
            loop: true
        });

        // Dark overlay for better text readability
        this.add.rectangle(240, 320, 480, 640, 0x000000, 0.4);

        // ===== TITLE =====

        this.add.image(width / 2, 36, 'oracle-logo')
            .setDisplaySize(44, 44)
            .setAlpha(0.95);

        this.add.text(width / 2, 72, 'Oracle Cloud Infrastructure', {
            fontFamily: 'monospace',
            fontSize: '18px',
            fill: '#ff3f2f',
            stroke: '#3a0500',
            strokeThickness: 3
        }).setOrigin(0.5);

        const titleDefense = this.add.text(width / 2, 120, 'DEFENSE GRID', {
            fontFamily: 'monospace',
            fontSize: '42px',
            fill: '#3ddc97',
            stroke: '#001f18',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.tweens.add({
            targets: [titleDefense],
            scale: { from: 1, to: 1.03 },
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // ===== SCROLLING STORY =====

        const storyText =
            'The OCI region is under load.\n\n' +
            'API Gateway reports spikes.\n' +
            'Load Balancers are shifting traffic.\n' +
            'Compute fleets are holding the line.\n\n' +
            'Functions process every event.\n' +
            'Streaming captures every signal.\n' +
            'OCI Cache keeps pilots live.\n' +
            'Autonomous Database ranks every run.\n' +
            'Object Storage archives raw events.\n' +
            'AI predicts the next anomaly.\n\n' +
            'Launch the grid defense.';

        const story = this.add.text(width / 2, 380, storyText, {
            fontFamily: 'monospace',
            fontSize: '14px',
            fill: '#888888',
            align: 'center',
            lineSpacing: 6
        }).setOrigin(0.5, 0);

        // Slow scroll animation - loops
        this.tweens.add({
            targets: story,
            y: { from: 380, to: 140 },
            duration: 18000,
            repeat: -1,
            ease: 'Linear'
        });

        // ===== DECORATIVE SHIP =====

        this.ship = this.add.sprite(240, 500, 'ship').setScale(3.2);
        this.ship.play('ship-thrust');

        // Ship floating animation
        this.tweens.add({
            targets: this.ship,
            y: { from: 500, to: 520 },
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // Ship subtle rotation
        this.tweens.add({
            targets: this.ship,
            angle: { from: -3, to: 3 },
            duration: 3000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // ===== MENU BUTTON =====

        this.callsignLabel = this.add.text(width / 2, 516, this.callsignText(), {
            fontFamily: 'monospace',
            fontSize: '16px',
            fill: '#7cc8ff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.callsignLabel.on('pointerdown', () => this.focusCallsignInput());
        this.callsignLabel.on('pointerover', () => this.callsignLabel.setFill('#ffffff'));
        this.callsignLabel.on('pointerout', () => this.callsignLabel.setFill('#7cc8ff'));

        const playBtn = this.createButton(width / 2, 560, '[ LAUNCH ]', '#00ff00', () => this.launch());

        // Pulsing effect on play button
        this.tweens.add({
            targets: playBtn,
            alpha: { from: 1, to: 0.7 },
            duration: 800,
            yoyo: true,
            repeat: -1
        });

        // Version
        this.add.text(width / 2, 625, 'v1.0', {
            fontFamily: 'monospace',
            fontSize: '10px',
            fill: '#222222'
        }).setOrigin(0.5);

        // Keyboard shortcuts
        this.input.keyboard.once('keydown-SPACE', () => {
            this.launch();
        });

        this.input.keyboard.once('keydown-ENTER', () => {
            this.launch();
        });

        // Initial screen flash
        this.cameras.main.flash(1000, 0, 0, 0);
    }

    update() {
        this.stars.tilePositionY -= 1;

        // Update background enemies
        this.bgEnemies.forEach((enemy, index) => {
            if (enemy.y > 700) {
                enemy.destroy();
                this.bgEnemies.splice(index, 1);
            }
        });
    }

    spawnBackgroundEnemy() {
        const enemies = [
            { key: 'enemy-small', anim: 'enemy-small-fly', scale: 2 },
            { key: 'enemy-medium', anim: 'enemy-medium-fly', scale: 2 },
            { key: 'enemy-big', anim: 'enemy-big-fly', scale: 1.4 }
        ];
        const config = Phaser.Math.RND.pick(enemies);

        const x = Phaser.Math.Between(50, 430);
        const enemy = this.add.sprite(x, -30, config.key)
            .setScale(config.scale)
            .setAlpha(0.4)
            .setDepth(-1);

        enemy.play(config.anim);

        this.tweens.add({
            targets: enemy,
            y: 700,
            duration: Phaser.Math.Between(4000, 8000),
            ease: 'Linear'
        });

        this.bgEnemies.push(enemy);
    }

    createButton(x, y, text, color, callback) {
        const btn = this.add.text(x, y, text, {
            fontFamily: 'monospace',
            fontSize: '24px',
            fill: color,
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        btn.setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => {
            btn.setScale(1.15);
            btn.setFill('#ffffff');
            this.tweens.add({
                targets: btn,
                x: x + 5,
                duration: 50,
                yoyo: true
            });
        });

        btn.on('pointerout', () => {
            btn.setScale(1);
            btn.setFill(color);
        });

        btn.on('pointerdown', callback);

        return btn;
    }

    callsignText() {
        return this.callsign ? `CALLSIGN: ${this.callsign}` : 'CALLSIGN: CLICK TO ENTER';
    }

    normalizeCallsign(value) {
        return String(value || '')
            .trim()
            .replace(/[^a-zA-Z0-9 _-]/g, '')
            .replace(/\s+/g, ' ')
            .slice(0, 14)
            .toUpperCase();
    }

    setupCallsignControls() {
        this.callsignInput = document.getElementById('pilotCallsign');
        this.startButton = document.getElementById('startMission');
        this.pilotBar = this.callsignInput?.closest('.pilot-bar');

        if (!this.callsignInput || !this.startButton) return;

        this.callsignInput.value = this.callsign;

        this.inputHandler = () => {
            this.callsign = this.normalizeCallsign(this.callsignInput.value);
            this.callsignInput.value = this.callsign;
            this.saveCallsign();
            this.callsignLabel?.setText(this.callsignText());
            this.pilotBar?.classList.remove('needs-name');
        };

        this.launchHandler = () => this.launch();
        this.inputKeyHandler = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.launch();
            }
        };

        this.callsignInput.addEventListener('input', this.inputHandler);
        this.callsignInput.addEventListener('keydown', this.inputKeyHandler);
        this.startButton.addEventListener('click', this.launchHandler);

        this.events.once('shutdown', () => {
            this.callsignInput?.removeEventListener('input', this.inputHandler);
            this.callsignInput?.removeEventListener('keydown', this.inputKeyHandler);
            this.startButton?.removeEventListener('click', this.launchHandler);
        });
    }

    saveCallsign() {
        if (this.callsign) {
            localStorage.setItem('playerCallsign', this.callsign);
        } else {
            localStorage.removeItem('playerCallsign');
        }
    }

    focusCallsignInput() {
        this.callsignInput?.focus();
        this.callsignInput?.select();
    }

    launch() {
        if (this.callsignInput) {
            this.callsign = this.normalizeCallsign(this.callsignInput.value);
            this.callsignInput.value = this.callsign;
            this.saveCallsign();
            this.callsignLabel.setText(this.callsignText());
        }

        if (!this.callsign) {
            this.pilotBar?.classList.add('needs-name');
            this.focusCallsignInput();
            this.callsignLabel.setFill('#ff6b6b');
            this.tweens.add({
                targets: this.callsignLabel,
                scale: { from: 1.12, to: 1 },
                duration: 240,
                ease: 'Back.easeOut',
                onComplete: () => this.callsignLabel.setFill('#7cc8ff')
            });
            return;
        }

        this.cameras.main.flash(500, 255, 255, 255);
        this.time.delayedCall(300, () => {
            this.scene.start('GameScene', { level: 1, callsign: this.callsign });
        });
    }
}
