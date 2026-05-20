export default class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    init(data) {
        this.finalScore = data.score || 0;
        this.level = data.level || 1;
        this.wave = data.wave || 1;
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        const centerY = height / 2;

        // Stop any previous music and play title music (somber mood)
        this.sound.stopAll();
        this.music = this.sound.add('music-title', { loop: true, volume: 0.3 });
        this.music.play();

        // Dark red tinted background
        this.bg = this.add.image(240, centerY, 'background')
            .setDisplaySize(480, height)
            .setTint(0x440000);

        // Scrolling stars (slower, red tinted)
        this.stars = this.add.tileSprite(0, 0, 480, height, 'stars')
            .setOrigin(0, 0)
            .setTileScale(2)
            .setTint(0xff4444)
            .setAlpha(0.5);

        // Single explosion on load
        this.time.delayedCall(200, () => {
            const explosion = this.add.sprite(240, 280, 'explosion-large')
                .setScale(2)
                .setAlpha(0.7)
                .setTint(0xff4400);
            explosion.play('explode-large');
            explosion.on('animationcomplete', () => explosion.destroy());
        });

        // ===== GAME OVER TITLE =====

        const failedText = this.add.text(width / 2, 120, 'MISSION FAILED', {
            fontFamily: 'monospace',
            fontSize: '42px',
            fill: '#ff0000',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.tweens.add({
            targets: failedText,
            scale: { from: 1.3, to: 1 },
            duration: 400,
            ease: 'Back.easeOut'
        });

        // ===== SCORE =====

        const scoreText = this.add.text(width / 2, 320, '0', {
            fontFamily: 'monospace',
            fontSize: '48px',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        this.tweens.addCounter({
            from: 0,
            to: this.finalScore,
            duration: 1200,
            ease: 'Power2',
            onUpdate: (tween) => {
                scoreText.setText(Math.floor(tween.getValue()).toString());
            }
        });

        // High score check
        const highScore = parseInt(localStorage.getItem('highScore')) || 0;
        if (this.finalScore > highScore) {
            localStorage.setItem('highScore', this.finalScore);

            const newHighText = this.add.text(width / 2, 370, 'NEW PERSONAL BEST', {
                fontFamily: 'monospace',
                fontSize: '16px',
                fill: '#ffff00',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5);

            this.tweens.add({
                targets: newHighText,
                alpha: { from: 1, to: 0.5 },
                duration: 400,
                yoyo: true,
                repeat: -1
            });
        }

        // ===== BUTTONS =====

        const retryBtn = this.add.text(width / 2, 480, '[ RETRY ]', {
            fontFamily: 'monospace',
            fontSize: '22px',
            fill: '#00ff00',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        retryBtn.on('pointerover', () => {
            retryBtn.setScale(1.1);
            retryBtn.setFill('#ffffff');
        });
        retryBtn.on('pointerout', () => {
            retryBtn.setScale(1);
            retryBtn.setFill('#00ff00');
        });
        retryBtn.on('pointerdown', () => {
            this.cameras.main.flash(300, 255, 255, 255);
            this.time.delayedCall(200, () => {
                this.scene.start('GameScene', { level: 1 });
            });
        });

        this.tweens.add({
            targets: retryBtn,
            alpha: { from: 1, to: 0.6 },
            duration: 500,
            yoyo: true,
            repeat: -1
        });

        const menuBtn = this.add.text(width / 2, 530, '[ MENU ]', {
            fontFamily: 'monospace',
            fontSize: '16px',
            fill: '#888888',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        menuBtn.on('pointerover', () => menuBtn.setFill('#ffffff'));
        menuBtn.on('pointerout', () => menuBtn.setFill('#888888'));
        menuBtn.on('pointerdown', () => {
            this.scene.start('MenuScene');
        });

        // ===== INPUT =====

        this.input.keyboard.once('keydown-SPACE', () => {
            this.cameras.main.flash(300, 255, 255, 255);
            this.time.delayedCall(200, () => {
                this.scene.start('GameScene', { level: 1 });
            });
        });

        this.input.keyboard.once('keydown-M', () => {
            this.scene.start('MenuScene');
        });

        // Initial effects
        this.cameras.main.shake(200, 0.015);
        this.cameras.main.flash(400, 255, 0, 0);
    }

    update() {
        this.stars.tilePositionY -= 0.3;
    }
}
