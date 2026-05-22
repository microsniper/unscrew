import { _decorator, Component, Node, Vec3, UITransform, Label, Color, tween, Graphics, director, Canvas, Mask, screen, ResolutionPolicy, Layers } from 'cc';
import { loginAndGetProgress, saveProgress } from './api';

const { ccclass } = _decorator;

export enum ScrewColor {
    RED = 'red',
    BLUE = 'blue',
    YELLOW = 'yellow',
    PINK = 'pink',
    ORANGE = 'orange',
    GREEN = 'green',
    PURPLE = 'purple',
    CYAN = 'cyan'
}

type BoxColor = ScrewColor | 'locked' | 'empty';
type PlateTheme = 'yellow' | 'blue';

interface PlateTemplate {
    type: 'circle' | 'rect';
    w: number;
    h: number;
    holes: { x: number; y: number }[];
}

interface ScrewData {
    id: string;
    color: ScrewColor;
    x: number;
    y: number;
    removed: boolean;
}

interface PlateData {
    id: string;
    type: 'circle' | 'rect';
    color: PlateTheme;
    w: number;
    h: number;
    x: number;
    y: number;
    layer: number;
    screws: ScrewData[];
    holes: { x: number; y: number }[];
    removed: boolean;
    isFalling?: boolean;
    fallDistance?: number;
    rotation?: number;
    gravityOrigin?: { x: number; y: number };
}

interface BoxData {
    color: BoxColor;
    capacity: number;
    screws: ScrewColor[];
    isNew: boolean;
    isSlidingOut?: boolean;
    clearScheduled?: boolean;
}

interface BoxSlotView {
    node: Node;
    hole: Graphics;
    screwHost: Node;
}

interface BoxView {
    node: Node;
    body: Graphics;
    lockLabel: Label;
    slots: BoxSlotView[];
}

interface TempSlotView {
    node: Node;
    hole: Graphics;
    screwHost: Node;
}

interface ToolView {
    key: 'add' | 'break' | 'clear';
    node: Node;
    iconLabel: Label;
    badge: Graphics;
    badgeLabel: Label;
}

const COLORS: ScrewColor[] = [
    ScrewColor.RED,
    ScrewColor.BLUE,
    ScrewColor.YELLOW,
    ScrewColor.PINK,
    ScrewColor.ORANGE,
    ScrewColor.GREEN,
    ScrewColor.PURPLE,
    ScrewColor.CYAN
];

const PLATE_TEMPLATES: PlateTemplate[] = [
    { type: 'rect', w: 160, h: 160, holes: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }] },
    { type: 'rect', w: 140, h: 140, holes: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }] },
    { type: 'rect', w: 110, h: 110, holes: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }] },
    { type: 'rect', w: 180, h: 100, holes: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] },
    { type: 'rect', w: 100, h: 180, holes: [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }] },
    { type: 'circle', w: 140, h: 140, holes: [{ x: 0.5, y: 0.5 }] }
];

const BOX_COLORS: Record<ScrewColor, Color> = {
    [ScrewColor.RED]: new Color(209, 82, 102),
    [ScrewColor.BLUE]: new Color(91, 137, 247),
    [ScrewColor.YELLOW]: new Color(250, 203, 73),
    [ScrewColor.PINK]: new Color(248, 127, 169),
    [ScrewColor.ORANGE]: new Color(245, 150, 68),
    [ScrewColor.GREEN]: new Color(85, 204, 163),
    [ScrewColor.PURPLE]: new Color(165, 96, 232),
    [ScrewColor.CYAN]: new Color(74, 192, 219)
};

const FACE_COLORS: Record<PlateTheme, Color> = {
    yellow: new Color(241, 208, 86, 255),
    blue: new Color(102, 138, 228, 255)
};

const SCREW_FACE_COLORS: Record<ScrewColor, Color> = {
    red: new Color(166, 75, 92, 255),
    blue: new Color(102, 138, 228, 255),
    yellow: new Color(242, 209, 90, 255),
    pink: new Color(231, 119, 170, 255),
    orange: new Color(245, 157, 59, 255),
    green: new Color(85, 189, 167, 255),
    purple: new Color(134, 88, 213, 255),
    cyan: new Color(90, 206, 226, 255)
};

const PAGE_CONTENT_SCALE = 0.9;
const TOP_CONTENT_OFFSET = 24;

@ccclass('GameManager')
export class GameManager extends Component {
    private rootNode: Node | null = null;
    private currentLevel = 1;
    private maxTempHoles = 5;
    private totalScrews = 0;
    private removedScrews = 0;
    private gameOver = false;

    private boxes: BoxData[] = [];
    private tempHoles: ScrewColor[] = [];
    private plates: PlateData[] = [];
    private tools = { add: 0, break: 1, clear: 1 };

    private topAreaNode: Node | null = null;
    private boardAreaNode: Node | null = null;
    private boardContentNode: Node | null = null;
    private boardEffectNode: Node | null = null;
    private bottomAreaNode: Node | null = null;
    private boxesContainerNode: Node | null = null;
    private tempContainerNode: Node | null = null;
    private toolContainerNode: Node | null = null;
    private modalLayerNode: Node | null = null;
    private titleLabel: Label | null = null;
    private levelBadgeLabel: Label | null = null;
    private progressLabel: Label | null = null;
    private plateNodes = new Map<string, Node>();
    private fallingPlateNodes = new Map<string, Node>();
    private boxViews: BoxView[] = [];
    private tempBgGraphics: Graphics | null = null;
    private tempSlotViews: TempSlotView[] = [];
    private toolViews: ToolView[] = [];

    private screenWidth = 0;
    private screenHeight = 0;
    private topHeight = 0;
    private boardHeight = 0;
    private bottomHeight = 0;
    private boardWidth = 0;

    async start() {
        this.setupLayout();
        this.currentLevel = await loginAndGetProgress();
        this.initGame();
    }

    private findCanvasNode() {
        const scene = director.getScene();
        if (!scene) return null;

        const stack: Node[] = [scene];
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (current.name === 'Canvas') {
                return current;
            }
            const children = current.children;
            for (let i = 0; i < children.length; i++) {
                stack.push(children[i]);
            }
        }
        return null;
    }


    private setupLayout() {
        // 使用固定的内部逻辑分辨率，确保所有硬编码的尺寸比例正常
        this.screenWidth = 375;
        this.screenHeight = 812;
        
        this.topHeight = this.screenHeight * 0.31;
        this.bottomHeight = this.screenHeight * 0.16;
        this.boardHeight = this.screenHeight - this.topHeight - this.bottomHeight;
        this.boardWidth = this.screenWidth * 0.94;

        if (this.rootNode) {
            this.rootNode.destroy();
        }
        this.plateNodes.clear();
        this.fallingPlateNodes.clear();
        this.boxViews = [];
        this.tempBgGraphics = null;
        this.tempSlotViews = [];
        this.toolViews = [];

        this.rootNode = new Node('GameRoot');
        this.rootNode.layer = Layers.Enum.UI_2D;
        const uiTransform = this.rootNode.addComponent(UITransform);
        uiTransform.setContentSize(this.screenWidth, this.screenHeight);

        // 寻找场景真实的 Canvas，以计算缩放比例
        let canvasNode: Node | null = null;
        const scene = director.getScene();
        if (scene) {
            const canvasComp = scene.getComponentInChildren(Canvas);
            if (canvasComp) {
                canvasNode = canvasComp.node;
            }
        }

        let scale = 1;
        if (canvasNode) {
            this.rootNode.parent = canvasNode;
            
            // 尝试通过 screen.windowSize 获取尺寸
            const windowSize = screen.windowSize;
            let visibleWidth = windowSize.width;
            let visibleHeight = windowSize.height;

            if (visibleWidth > 0 && visibleHeight > 0) {
                // 如果是真机高分屏，尺寸可能会极大，需要除以 devicePixelRatio 转换回逻辑像素
                const dpr = screen.devicePixelRatio || 1;
                visibleWidth = visibleWidth / dpr;
                visibleHeight = visibleHeight / dpr;

                const scaleX = visibleWidth / this.screenWidth;
                const scaleY = visibleHeight / this.screenHeight;
                scale = Math.min(scaleX, scaleY);
            } else {
                const canvasUI = canvasNode.getComponent(UITransform);
                if (canvasUI && canvasUI.width > 0 && canvasUI.height > 0) {
                    const scaleX = canvasUI.width / this.screenWidth;
                    const scaleY = canvasUI.height / this.screenHeight;
                    scale = Math.min(scaleX, scaleY);
                }
            }
        } else {
            this.rootNode.parent = this.node.parent || this.node;
        }

        // 整体缩小一圈，让真机上更接近原来的 Vue 版留白感
        this.rootNode.setScale(new Vec3(scale * PAGE_CONTENT_SCALE, scale * PAGE_CONTENT_SCALE, 1));
        this.rootNode.setPosition(new Vec3(0, 0, 0));

        // 清理当前测试节点的默认文字
        const defaultLabelNode = this.node.getChildByName('Label');
        if (defaultLabelNode) {
            defaultLabelNode.active = false;
        }

        const background = this.createGraphicsNode('Background', this.rootNode, this.screenWidth, this.screenHeight, 0, 0);
        this.drawRoundedRect(background.getComponent(Graphics)!, this.screenWidth, this.screenHeight, new Color(232, 239, 247, 255), 0);

        const topY = this.screenHeight / 2 - this.topHeight / 2;
        const boardY = -this.screenHeight / 2 + this.bottomHeight + this.boardHeight / 2;
        const bottomY = -this.screenHeight / 2 + this.bottomHeight / 2;

        this.topAreaNode = this.createNode('TopArea', this.rootNode, 0, topY, this.screenWidth, this.topHeight);
        const topBg = this.createGraphicsNode('TopBg', this.topAreaNode, this.screenWidth, this.topHeight, 0, 0);
        this.drawRoundedRect(topBg.getComponent(Graphics)!, this.screenWidth, this.topHeight, new Color(240, 244, 249, 255), 0);

        this.boardAreaNode = this.createNode('BoardArea', this.rootNode, 0, boardY, this.screenWidth, this.boardHeight);
        const boardMask = this.boardAreaNode.addComponent(Mask);
        
        const boardBg = this.createGraphicsNode('BoardBg', this.boardAreaNode, this.screenWidth, this.boardHeight, 0, 0);
        this.drawRoundedRect(boardBg.getComponent(Graphics)!, this.screenWidth, this.boardHeight, new Color(204, 220, 235, 255), 0);

        this.boardContentNode = this.createNode('BoardContent', this.boardAreaNode, 0, 0, this.boardWidth, this.boardHeight - 20);
        this.boardEffectNode = this.createNode('BoardEffect', this.boardAreaNode, 0, 0, this.boardWidth, this.boardHeight - 20);

        this.bottomAreaNode = this.createNode('BottomArea', this.rootNode, 0, bottomY, this.screenWidth, this.bottomHeight);
        const bottomBg = this.createGraphicsNode('BottomBg', this.bottomAreaNode, this.screenWidth, this.bottomHeight, 0, 0);
        this.drawRoundedRect(bottomBg.getComponent(Graphics)!, this.screenWidth, this.bottomHeight, new Color(201, 218, 234, 255), 0);

        this.modalLayerNode = this.createNode('ModalLayer', this.rootNode, 0, 0, this.screenWidth, this.screenHeight);
        this.modalLayerNode.setSiblingIndex(999);

        this.buildStaticTopUI();
        this.boxesContainerNode = this.createNode('Boxes', this.topAreaNode, 0, 8 - TOP_CONTENT_OFFSET, this.screenWidth - 40, 130);
        this.tempContainerNode = this.createNode('TempSlots', this.topAreaNode, 0, -this.topHeight * 0.26 - TOP_CONTENT_OFFSET, this.screenWidth - 60, 90);
        this.toolContainerNode = this.createNode('Tools', this.bottomAreaNode, 0, 0, this.screenWidth - 40, this.bottomHeight - 10);
    }

    private buildStaticTopUI() {
        if (!this.topAreaNode) return;

        const topInnerY = this.topHeight / 2 - 42 - TOP_CONTENT_OFFSET;

        this.levelBadgeLabel = this.createLabel(this.topAreaNode, '第 1 关', 0, topInnerY + 8, 22, new Color(255, 255, 255, 255), true);

        const badge = this.createGraphicsNode('LevelBadgeBg', this.topAreaNode, 130, 44, 0, topInnerY + 8);
        badge.setSiblingIndex(0);
        this.drawRoundedRect(badge.getComponent(Graphics)!, 130, 44, new Color(165, 172, 183, 255), 22);
        this.progressLabel = null;
    }

    private initGame() {
        this.gameOver = false;
        this.tempHoles = [];
        this.removedScrews = 0;
        this.tools = { add: 0, break: 1, clear: 1 };
        this.fallingPlateNodes.clear();
        if (this.boardEffectNode) {
            this.boardEffectNode.removeAllChildren();
        }
        this.boxes = [
            { color: ScrewColor.YELLOW, capacity: 3, screws: [], isNew: false, isSlidingOut: false, clearScheduled: false },
            { color: ScrewColor.BLUE, capacity: 3, screws: [], isNew: false, isSlidingOut: false, clearScheduled: false },
            { color: 'locked', capacity: 3, screws: [], isNew: false, isSlidingOut: false, clearScheduled: false },
            { color: 'locked', capacity: 3, screws: [], isNew: false, isSlidingOut: false, clearScheduled: false }
        ];
        this.generateLevel();
        this.ensurePrimaryBoxes();
        this.renderAll();
    }

    private renderAll() {
        this.renderTopUI();
        this.renderBoard();
        this.renderTools();
        this.renderModal(null);
    }

    private renderTopUI() {
        this.ensurePrimaryBoxes();
        this.normalizeEndgameBoxes();

        if (this.titleLabel) {
            this.titleLabel.string = '放我出去呗';
        }
        if (this.levelBadgeLabel) {
            this.levelBadgeLabel.string = `第 ${this.currentLevel} 关`;
        }
        this.renderBoxes();
        this.renderTempSlots();
    }

    private renderBoxes() {
        if (!this.boxesContainerNode) return;
        this.ensureBoxViews();

        const boxWidth = Math.min(84, this.screenWidth * 0.2);
        const boxHeight = 92;
        const gap = (this.screenWidth - 40 - boxWidth * 4) / 3;
        const startX = -((boxWidth * 4 + gap * 3) / 2) + boxWidth / 2;

        this.boxes.forEach((box, index) => {
            if (index < 2 && !this.isValidPrimaryBoxColor(box.color)) {
                const fallback = this.getPrimaryBoxFallbackColor(index);
                this.updateBoxColor(box, fallback);
            }

            const x = startX + index * (boxWidth + gap);
            const view = this.boxViews[index];
            const boxNode = view.node;
            boxNode.setPosition(new Vec3(x, 0, 0));
            boxNode.active = true;
            const bodyColor = box.color === 'locked'
                ? new Color(91, 204, 189, 255)
                : box.color === 'empty'
                    ? new Color(200, 200, 200, 255) // 修复空盒子颜色不可见问题
                    : this.getBoxColor(box.color);
            this.drawRoundedRect(view.body, boxWidth, boxHeight, bodyColor, 12, box.color === 'empty' ? 0 : 4, new Color(255, 255, 255, 210));

            const isLocked = box.color === 'locked';
            view.lockLabel.node.active = isLocked;
            view.slots.forEach((slotView, slotIndex) => {
                slotView.node.active = !isLocked;
                if (isLocked) {
                    this.updateScrewHost(slotView.screwHost, 26);
                    return;
                }

                const screwColor = box.color === 'empty' ? undefined : box.screws[slotIndex];
                slotView.hole.node.active = !screwColor;
                this.updateScrewHost(slotView.screwHost, 26, screwColor);
            });

            if (box.isNew) {
                boxNode.scale = new Vec3(0.92, 0.92, 1);
                tween(boxNode).to(0.18, { scale: new Vec3(1.04, 1.04, 1) }).to(0.16, { scale: new Vec3(1, 1, 1) }).start();
                box.isNew = false;
            } else {
                boxNode.setScale(new Vec3(1, 1, 1));
            }
        });
    }

    private renderTempSlots() {
        if (!this.tempContainerNode) return;
        this.ensureTempSlotViews();

        const containerW = this.screenWidth - 154;
        const containerH = 36;
        if (this.tempBgGraphics) {
            this.drawRoundedRect(this.tempBgGraphics, containerW, containerH, new Color(228, 233, 240, 255), 15, 2, new Color(255, 255, 255, 180));
        }

        this.tempSlotViews.forEach((slotView, index) => {
            const color = this.tempHoles[index];
            this.updateScrewHost(slotView.screwHost, 26, color);
        });
    }

    private renderTools() {
        if (!this.toolContainerNode) return;
        this.ensureToolViews();

        const toolList = [
            { key: 'add' as const, label: '加孔位', icon: '🔍', count: this.tools.add },
            { key: 'break' as const, label: '熔玻璃', icon: '🔨', count: this.tools.break },
            { key: 'clear' as const, label: '清空孔位', icon: '🧹', count: this.tools.clear }
        ];
        toolList.forEach((tool, index) => {
            const view = this.toolViews[index];
            view.iconLabel.string = tool.icon;
            view.iconLabel.color = (tool.count <= 0 && tool.key !== 'add')
                ? new Color(200, 200, 200, 255)
                : new Color(255, 255, 255, 255);
            const badgeColor = (tool.count <= 0 && tool.key !== 'add') ? new Color(168, 162, 158, 255) : new Color(245, 158, 11, 255);
            this.drawCircle(view.badge, 13, badgeColor, 3, new Color(255, 238, 196, 255));
            view.badgeLabel.string = String(tool.count > 0 ? tool.count : '+');
        });
    }

    private renderBoard() {
        if (!this.boardContentNode) return;
        this.boardContentNode.removeAllChildren();
        this.plateNodes.clear();

        const visiblePlates = this.plates.filter((plate) => !plate.removed).sort((a, b) => a.layer - b.layer);
        visiblePlates.forEach((plate) => {
            this.createPlateNode(this.boardContentNode!, plate, true);
        });
    }

    private renderModal(config: { title: string; sub: string; button: string; onConfirm: () => void } | null) {
        if (!this.modalLayerNode) return;
        this.modalLayerNode.removeAllChildren();
        if (!config) return;

        const mask = this.createGraphicsNode('Mask', this.modalLayerNode, this.screenWidth, this.screenHeight, 0, 0);
        this.drawRoundedRect(mask.getComponent(Graphics)!, this.screenWidth, this.screenHeight, new Color(0, 0, 0, 110), 0);

        const panel = this.createNode('Panel', this.modalLayerNode, 0, 0, this.screenWidth * 0.72, 220);
        const panelBg = this.createGraphicsNode('PanelBg', panel, this.screenWidth * 0.72, 220, 0, 0);
        this.drawRoundedRect(panelBg.getComponent(Graphics)!, this.screenWidth * 0.72, 220, new Color(255, 255, 255, 255), 24);

        this.createLabel(panel, config.title, 0, 50, 28, new Color(32, 36, 42, 255), true);
        this.createLabel(panel, config.sub, 0, 4, 18, new Color(88, 95, 108, 255), true, 28);

        const button = this.createNode('Confirm', panel, 0, -66, 150, 54);
        const buttonBg = this.createGraphicsNode('BtnBg', button, 150, 54, 0, 0);
        this.drawRoundedRect(buttonBg.getComponent(Graphics)!, 150, 54, new Color(136, 74, 231, 255), 27);
        this.createLabel(button, config.button, 0, 0, 20, new Color(255, 255, 255, 255), true);
        button.on(Node.EventType.TOUCH_END, () => {
            this.renderModal(null);
            config.onConfirm();
        }, this);
    }

    private getProgressText() {
        if (this.totalScrews <= 0) return '0%';
        return `${Math.floor((this.removedScrews / this.totalScrews) * 100)}%`;
    }

    private generateLevel() {
        this.plates = [];

        const levelNum = this.currentLevel;
        const numColors = Math.min(COLORS.length, 4 + Math.floor((levelNum - 1) / 2));
        const activeColors = COLORS.slice(0, numColors);
        this.boxes[0].color = 'empty';
        this.boxes[1].color = 'empty';
        this.boxes[2].color = 'locked';
        this.boxes[3].color = 'locked';
        this.boxes.forEach((box) => {
            box.screws = [];
            box.isNew = false;
            box.isSlidingOut = false;
        });
        const numTriplets = Math.min(15, 2 + levelNum);
        const screwsToPlace: ScrewColor[] = [];

        for (let i = 0; i < numTriplets; i++) {
            const color = activeColors[Math.floor(Math.random() * activeColors.length)];
            screwsToPlace.push(color, color, color);
        }

        screwsToPlace.sort(() => Math.random() - 0.5);
        this.totalScrews = screwsToPlace.length;

        const distinctColors = [...new Set(screwsToPlace)];
        this.boxes[0].color = distinctColors[0] || ScrewColor.YELLOW;
        if (distinctColors.length > 1) {
            this.boxes[1].color = distinctColors[1];
        } else {
            const otherColors = activeColors.filter((color) => color !== distinctColors[0]);
            this.boxes[1].color = otherColors.length > 0
                ? otherColors[Math.floor(Math.random() * otherColors.length)]
                : (distinctColors[0] || ScrewColor.BLUE);
        }

        let availableTemplates = PLATE_TEMPLATES;
        if (levelNum === 1) {
            availableTemplates = PLATE_TEMPLATES.filter((template) => template.holes.length >= 3);
        }

        const spreadFactor = Math.max(0.62, 1.16 - levelNum * 0.07);
        const rangeX = 168 * spreadFactor;
        const rangeY = 228 * spreadFactor;
        const centerYOffset = 12;
        const generatedCenters: { x: number; y: number }[] = [];
        let totalHolesAvailable = 0;
        let plateIndex = 0;

        while (totalHolesAvailable < this.totalScrews) {
            const template = availableTemplates[Math.floor(Math.random() * availableTemplates.length)];
            let x = 0;
            let y = 0;
            let bestDistance = -1;

            for (let tryCount = 0; tryCount < 10; tryCount++) {
                const tx = (Math.random() * 2 - 1) * rangeX;
                const ty = centerYOffset + (Math.random() * 2 - 1) * rangeY;
                if (generatedCenters.length === 0) {
                    x = tx;
                    y = ty;
                    break;
                }

                let minDistance = 9999;
                generatedCenters.forEach((center) => {
                    const distance = Math.sqrt(Math.pow(tx - center.x, 2) + Math.pow(ty - center.y, 2));
                    if (distance < minDistance) {
                        minDistance = distance;
                    }
                });

                if (minDistance > bestDistance) {
                    bestDistance = minDistance;
                    x = tx;
                    y = ty;
                }
            }

            const maxLayer = levelNum === 1 ? 1 : Math.min(8, 2 + Math.floor(levelNum * 1.4));
            const layer = Math.floor(Math.random() * maxLayer);
            const rotation = template.type === 'circle' ? 0 : (Math.random() > 0.5 ? 0 : 90);
            const renderW = rotation === 90 ? template.h : template.w;
            const renderH = rotation === 90 ? template.w : template.h;

            // 限制板子不要超出棋盘边缘
            const padding = 10;
            const maxLeft = -this.boardWidth / 2 + renderW / 2 + padding;
            const maxRight = this.boardWidth / 2 - renderW / 2 - padding;
            const maxBottom = -this.boardHeight / 2 + renderH / 2 + padding;
            const maxTop = this.boardHeight / 2 - renderH / 2 - padding;

            x = Math.max(maxLeft, Math.min(maxRight, x));
            y = Math.max(maxBottom, Math.min(maxTop, y));

            generatedCenters.push({ x, y });

            const actualHoles = template.holes.map((hole) => {
                if (rotation === 90) {
                    return { x: hole.y * template.h, y: (1 - hole.x) * template.w };
                }
                return { x: hole.x * template.w, y: hole.y * template.h };
            });

            this.plates.push({
                id: `p${plateIndex++}`,
                type: template.type,
                color: Math.random() > 0.5 ? 'yellow' : 'blue',
                w: renderW,
                h: renderH,
                x,
                y,
                layer,
                screws: [],
                holes: actualHoles,
                removed: false,
                isFalling: false,
                fallDistance: 0,
                rotation: 0
            });

            totalHolesAvailable += actualHoles.length;
        }

        const allAvailableHoles: { plate: PlateData; holeIndex: number }[] = [];
        this.plates.forEach((plate) => {
            plate.holes.forEach((_, holeIndex) => {
                allAvailableHoles.push({ plate, holeIndex });
            });
        });
        allAvailableHoles.sort(() => Math.random() - 0.5);

        screwsToPlace.forEach((color, index) => {
            const target = allAvailableHoles.pop();
            if (!target) return;
            const hole = target.plate.holes[target.holeIndex];
            target.plate.screws.push({
                id: `s_${index}`,
                color,
                x: hole.x,
                y: hole.y,
                removed: false
            });
        });

        this.plates = this.plates.filter((plate) => plate.screws.length > 0);
        this.plates.forEach((plate) => this.updatePlateGravity(plate));
    }

    private updatePlateGravity(plate: PlateData) {
        const remaining = plate.screws.filter(s => !s.removed);
        if (remaining.length !== 1) {
            plate.rotation = 0;
            plate.gravityOrigin = undefined;
            return;
        }
        
        const anchorX = remaining[0].x;
        const anchorY = remaining[0].y;
        
        const cx = plate.w / 2;
        const cy = plate.h / 2;
        
        const dx = cx - anchorX;
        const dy = cy - anchorY;
        
        if (dy <= 0 && Math.abs(dx) < 10) {
            plate.rotation = 0;
            plate.gravityOrigin = undefined;
            return;
        }
        
        let targetRotation = Math.atan2(dx, dy) * (180 / Math.PI);
        // Cocos Creator uses counter-clockwise rotation for positive angles, but the math gives clockwise.
        // Let's negate it for Cocos.
        targetRotation = -targetRotation;
        
        plate.rotation = targetRotation;
        plate.gravityOrigin = { x: anchorX, y: anchorY };
    }

    private handleScrewClick(plate: PlateData, screw: ScrewData) {
        if (this.gameOver) return;

        if (this.isScrewBlocked(plate, screw)) {
            this.triggerVibration('light');
            const plateNode = this.plateNodes.get(plate.id);
            if (plateNode) {
                const origin = plateNode.position.clone();
                tween(plateNode)
                    .stop()
                    .to(0.05, { position: new Vec3(origin.x + 6, origin.y, 0) })
                    .to(0.05, { position: new Vec3(origin.x - 6, origin.y, 0) })
                    .to(0.05, { position: new Vec3(origin.x, origin.y, 0) })
                    .start();
            }
            return;
        }

        this.triggerVibration('heavy');

        const targetBox = this.boxes.find((box) => box.color === screw.color && box.screws.length < box.capacity);
        if (!targetBox) {
            if (this.tempHoles.length >= this.maxTempHoles) {
                this.gameOver = true;
                this.renderModal({
                    title: '暂存孔满了',
                    sub: '孔位已满，重试这一关吧',
                    button: '重试一次',
                    onConfirm: () => {
                        this.initGame();
                    }
                });
                return;
            }
            this.tempHoles.push(screw.color);
        } else {
            targetBox.screws.push(screw.color);
        }

        screw.removed = true;
        this.removedScrews++;

        this.renderTopUI();

        if (targetBox && targetBox.screws.length === targetBox.capacity) {
            this.scheduleBoxClear(targetBox, 0.25, true);
        }

        const remaining = plate.screws.filter((item) => !item.removed);
        if (remaining.length === 0) {
            this.startPlateFalling(plate);
        } else {
            const oldRotation = plate.rotation || 0;
            this.updatePlateGravity(plate);
            const plateNode = this.refreshPlateNode(plate, oldRotation);

            if (oldRotation !== (plate.rotation || 0)) {
                if (plateNode) {
                    // 旋转动画时间从 0.5 秒延长到 1.2 秒，使用 backOut 缓动让它下垂时有轻微回弹，显得更真实沉重
                    tween(plateNode).stop();
                    tween(plateNode)
                        .to(1.2, { angle: plate.rotation || 0 }, { easing: 'backOut' })
                        .start();
                }
            }

            this.checkWin();
        }
    }

    private clearBoxAndAssignNewColor(targetBox: BoxData) {
        if (!this.canClearBox(targetBox)) {
            targetBox.clearScheduled = false;
            targetBox.isSlidingOut = false;
            this.renderBoxes();
            return;
        }

        targetBox.clearScheduled = false;
        targetBox.isSlidingOut = true;
        this.renderBoxes();

        this.scheduleOnce(() => {
            if (!this.canClearBox(targetBox)) {
                targetBox.isSlidingOut = false;
                this.renderBoxes();
                return;
            }

            targetBox.screws = [];
            targetBox.isSlidingOut = false;

            const nextColor = this.pickRefreshColor(targetBox);
            this.updateBoxColor(targetBox, nextColor);
            targetBox.isNew = nextColor !== 'empty';
            this.renderTopUI();
            this.autoFillFromTemp();
            this.checkWin();
        }, 0.38);
    }

    private autoFillFromTemp() {
        let changed = false;
        for (let i = this.tempHoles.length - 1; i >= 0; i--) {
            const color = this.tempHoles[i];
            const targetBox = this.boxes.find((box) => box.color === color && box.screws.length < box.capacity);
            if (!targetBox) continue;
            targetBox.screws.push(color);
            this.tempHoles.splice(i, 1);
            changed = true;

            if (targetBox.screws.length === targetBox.capacity) {
                this.scheduleBoxClear(targetBox, 0.2);
            }
        }
        if (changed) {
            this.renderTopUI();
            this.checkWin();
        }
    }

    private getRemainingColors() {
        const colors = new Set<ScrewColor>();
        this.plates.forEach((plate) => {
            if (plate.removed) return;
            plate.screws.forEach((screw) => {
                if (!screw.removed) {
                    colors.add(screw.color);
                }
            });
        });
        this.tempHoles.forEach((color) => colors.add(color));
        return Array.from(colors);
    }

    private isValidPrimaryBoxColor(color: BoxColor): color is ScrewColor {
        return COLORS.indexOf(color as ScrewColor) !== -1;
    }

    private getPrimaryBoxFallbackColor(index: number): ScrewColor {
        const remaining = this.getRemainingColors();
        const otherPrimary = index === 0 ? this.boxes[1] : this.boxes[0];
        const otherColor = otherPrimary && this.isValidPrimaryBoxColor(otherPrimary.color)
            ? otherPrimary.color
            : null;
        const candidate = remaining.find((color) => color !== otherColor);
        if (candidate) return candidate;
        return COLORS[index] || ScrewColor.YELLOW;
    }

    private updateBoxColor(box: BoxData, color: BoxColor) {
        if (box.color === color) return;
        box.clearScheduled = false;
        box.isSlidingOut = false;
        box.color = color;
        if (color === 'locked' || color === 'empty') {
            box.screws = [];
            return;
        }
        if (box.screws.some((screw) => screw !== color)) {
            box.screws = [];
        }
    }

    private getOutstandingColorCount(color: ScrewColor) {
        let count = 0;
        this.boxes.forEach((box) => {
            count += box.screws.filter((screw) => screw === color).length;
        });
        this.tempHoles.forEach((tempColor) => {
            if (tempColor === color) count++;
        });
        this.plates.forEach((plate) => {
            if (plate.removed) return;
            plate.screws.forEach((screw) => {
                if (!screw.removed && screw.color === color) {
                    count++;
                }
            });
        });
        return count;
    }

    private getPreferredRefreshColors() {
        const weights = new Map<ScrewColor, number>();
        const addWeight = (color: ScrewColor, weight: number) => {
            weights.set(color, (weights.get(color) || 0) + weight);
        };

        this.tempHoles.forEach((color) => addWeight(color, 100));
        this.plates.forEach((plate) => {
            if (plate.removed) return;
            plate.screws.forEach((screw) => {
                if (screw.removed) return;
                addWeight(screw.color, 1);
                if (!this.isScrewBlocked(plate, screw)) {
                    addWeight(screw.color, 20);
                }
            });
        });

        return Array.from(weights.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([color]) => color);
    }

    private pickRefreshColor(targetBox: BoxData): BoxColor {
        const currentColors = this.boxes
            .filter((box) => box !== targetBox && box.color !== 'locked' && box.color !== 'empty')
            .map((box) => box.color as ScrewColor);

        const preferred = this.getPreferredRefreshColors();
        const preferredAvailable = preferred.filter((color) => currentColors.indexOf(color) === -1);
        if (preferredAvailable.length > 0) {
            return preferredAvailable[0];
        }

        const remaining = this.getRemainingColors().filter((color) => currentColors.indexOf(color) === -1);
        if (remaining.length > 0) {
            return remaining[0];
        }

        if (preferred.length > 0) {
            return preferred[0];
        }

        return 'empty';
    }

    private getUniqueReplacementColor(exclude: BoxData, duplicateColor: ScrewColor): BoxColor {
        const remaining = this.getRemainingColors().filter((color) => color !== duplicateColor);
        const activeColors = this.boxes
            .filter((box) => box !== exclude && box.color !== 'locked' && box.color !== 'empty')
            .map((box) => box.color as ScrewColor);

        const available = remaining.filter((color) => activeColors.indexOf(color) === -1);
        if (available.length > 0) {
            return available[0];
        }

        const fallback = COLORS.filter((color) => color !== duplicateColor && activeColors.indexOf(color) === -1);
        if (fallback.length > 0) {
            return fallback[0];
        }

        return 'empty';
    }

    private normalizeEndgameBoxes() {
        const activeBoxes = this.boxes.filter((box): box is BoxData & { color: ScrewColor } => this.isValidPrimaryBoxColor(box.color));
        const processed = new Set<ScrewColor>();

        activeBoxes.forEach((box) => {
            const color = box.color;
            if (processed.has(color)) return;
            processed.add(color);

            const sameColorBoxes = this.boxes.filter((item) => item.color === color);
            if (sameColorBoxes.length <= 1) return;

            const outstandingCount = this.getOutstandingColorCount(color);
            if (outstandingCount > box.capacity) return;

            sameColorBoxes.sort((a, b) => b.screws.length - a.screws.length);
            const primary = sameColorBoxes[0];
            let mergedCount = 0;
            sameColorBoxes.forEach((item) => {
                mergedCount += item.screws.filter((screw) => screw === color).length;
            });
            primary.screws = Array(Math.min(primary.capacity, mergedCount)).fill(color);

            for (let i = 1; i < sameColorBoxes.length; i++) {
                const extraBox = sameColorBoxes[i];
                extraBox.screws = [];
                this.updateBoxColor(extraBox, this.getUniqueReplacementColor(extraBox, color));
            }

            if (this.canClearBox(primary)) {
                this.scheduleBoxClear(primary, 0.2);
            }
        });
    }

    private canClearBox(box: BoxData) {
        return this.isValidPrimaryBoxColor(box.color)
            && box.screws.length === box.capacity
            && box.screws.every((screw) => screw === box.color);
    }

    private scheduleBoxClear(box: BoxData, delay: number, withSuccessVibration: boolean = false) {
        if (box.clearScheduled || !this.canClearBox(box)) return;

        box.clearScheduled = true;
        this.scheduleOnce(() => {
            if (withSuccessVibration && this.canClearBox(box)) {
                this.triggerVibration('success');
            }
            this.clearBoxAndAssignNewColor(box);
        }, delay);
    }

    private ensurePrimaryBoxes() {
        const firstTwo = this.boxes.slice(0, 2);
        const active = firstTwo.filter((box) => this.isValidPrimaryBoxColor(box.color));
        const missing = 2 - active.length;
        if (missing <= 0) {
            if (this.boxes[0].color === this.boxes[1].color) {
                this.updateBoxColor(this.boxes[1], this.getPrimaryBoxFallbackColor(1));
            }
            return;
        }

        const remaining = this.getRemainingColors();
        const used = new Set(active.map((box) => box.color as ScrewColor));
        const fillColors = remaining.filter((color) => !used.has(color));

        for (let i = 0; i < 2; i++) {
            const box = this.boxes[i];
            if (this.isValidPrimaryBoxColor(box.color)) continue;
            const color = fillColors.shift() || remaining[0] || COLORS[i] || ScrewColor.YELLOW;
            this.updateBoxColor(box, color);
            box.screws = [];
        }

        if (this.boxes[0].color === this.boxes[1].color) {
            this.updateBoxColor(this.boxes[1], this.getPrimaryBoxFallbackColor(1));
        }
    }

    private reevaluateBoxColors() {
        const remaining = this.getRemainingColors();
        if (remaining.length === 0) return;

        const activeBoxes = this.boxes.filter((box) => box.color !== 'locked' && box.color !== 'empty');
        const missingColors = remaining.filter((color) => !activeBoxes.some((box) => box.color === color));
        if (missingColors.length === 0) return;

        const emptyActiveBoxes = activeBoxes.filter((box) => box.screws.length === 0);
        if (emptyActiveBoxes.length > 0) {
            this.updateBoxColor(emptyActiveBoxes[0], missingColors[0]);
            this.scheduleOnce(() => this.autoFillFromTemp(), 0.1);
        }
    }

    private handleUnlockBox(targetBox: BoxData) {
        if (this.gameOver || targetBox.color !== 'locked') return;

        const remaining = this.getRemainingColors();
        const active = this.boxes.filter((box) => box.color !== 'locked' && box.color !== 'empty').map((box) => box.color);
        let available = remaining.filter((color) => active.indexOf(color) === -1);
        if (available.length === 0) {
            available = COLORS.filter((color) => active.indexOf(color) === -1);
        }

        if (available.length > 0) {
            this.updateBoxColor(targetBox, available[Math.floor(Math.random() * available.length)]);
            targetBox.isNew = true;
            this.renderTopUI();
            this.autoFillFromTemp();
        }
    }

    private useTool(type: 'add' | 'break' | 'clear') {
        if (this.gameOver) return;

        if (type === 'add') {
            const lockedBox = this.boxes.find((box) => box.color === 'locked');
            if (!lockedBox) return;
            this.tryConsumeTool(type, () => this.handleUnlockBox(lockedBox));
            return;
        }

        if (type === 'break') {
            const visible = this.plates.filter((plate) => !plate.removed);
            if (visible.length === 0) return;
            this.tryConsumeTool(type, () => {
                visible.sort((a, b) => b.layer - a.layer);
                const target = visible[0];
                this.startPlateFalling(target);
            });
            return;
        }

        const hasPartialBox = this.boxes.some((box) => box.color !== 'locked' && box.color !== 'empty' && box.screws.length > 0 && box.screws.length < box.capacity);
        if (!hasPartialBox && this.tempHoles.length === 0) return;
        this.tryConsumeTool(type, () => {
            this.boxes.forEach((box) => {
                if (box.color !== 'locked' && box.color !== 'empty' && box.screws.length > 0 && box.screws.length < box.capacity) {
                    box.screws = [];
                }
            });
            this.tempHoles = [];
            this.reevaluateBoxColors();
            this.renderTopUI();
        });
    }

    private tryConsumeTool(type: 'add' | 'break' | 'clear', callback: () => void) {
        if (this.tools[type] > 0) {
            this.tools[type]--;
        }
        callback();
        this.renderTools();
    }

    private startPlateFalling(plate: PlateData) {
        if (plate.removed || plate.isFalling || !this.boardEffectNode) return;

        const fallingNode = this.createPlateNode(this.boardEffectNode, plate, false);

        if (!fallingNode) return;

        plate.removed = true;
        plate.isFalling = true;
        this.destroyPlateNode(plate.id);
        this.fallingPlateNodes.set(plate.id, fallingNode);

        tween(fallingNode)
            .to(1.2, { position: new Vec3(fallingNode.position.x, fallingNode.position.y - 800, 0) }, { easing: 'quadIn' })
            .call(() => {
                this.triggerVibration('success');
                plate.isFalling = false;
                const activeNode = this.fallingPlateNodes.get(plate.id);
                if (activeNode && activeNode.isValid) {
                    activeNode.destroy();
                }
                this.fallingPlateNodes.delete(plate.id);
                this.checkWin();
            })
            .start();
    }

    private checkWin() {
        if (this.gameOver) return;
        if (this.fallingPlateNodes.size > 0) return;
        const allRemoved = this.plates.every((plate) => plate.removed);
        if (!allRemoved || this.tempHoles.length > 0) return;

        this.gameOver = true;
        this.renderModal({
            title: '通关成功',
            sub: `太棒了，你已完成第 ${this.currentLevel} 关`,
            button: '下一关',
            onConfirm: () => {
                this.currentLevel++;
                saveProgress(this.currentLevel);
                this.initGame();
            }
        });
    }

    private isScrewBlocked(plate: PlateData, screw: ScrewData) {
        const screwAbsX = plate.x - plate.w / 2 + screw.x;
        const screwAbsY = plate.y + plate.h / 2 - screw.y;
        const samplePoints = [
            { x: 0, y: 0 },
            { x: 0, y: -8 },
            { x: 8, y: 0 },
            { x: 0, y: 8 },
            { x: -8, y: 0 },
            { x: 6, y: -6 },
            { x: 6, y: 6 },
            { x: -6, y: 6 },
            { x: -6, y: -6 }
        ];

        for (const other of this.plates) {
            if (other.id === plate.id || other.removed || other.layer <= plate.layer) continue;
            let insideCount = 0;
            samplePoints.forEach((point) => {
                if (this.isPointInsidePlate(other, screwAbsX + point.x, screwAbsY + point.y)) {
                    insideCount++;
                }
            });
            if (insideCount >= 7) {
                return true;
            }
        }
        return false;
    }

    private isPointInsidePlate(plate: PlateData, x: number, y: number) {
        const rotation = plate.rotation || 0;
        let localX = x;
        let localY = y;

        if (rotation !== 0) {
            const originX = plate.x - plate.w / 2 + (plate.gravityOrigin?.x ?? plate.w / 2);
            const originY = plate.y + plate.h / 2 - (plate.gravityOrigin?.y ?? plate.h / 2);
            const rad = -rotation * Math.PI / 180;
            const dx = x - originX;
            const dy = y - originY;
            localX = originX + dx * Math.cos(rad) - dy * Math.sin(rad);
            localY = originY + dx * Math.sin(rad) + dy * Math.cos(rad);
        }

        const left = plate.x - plate.w / 2;
        const right = plate.x + plate.w / 2;
        const bottom = plate.y - plate.h / 2;
        const top = plate.y + plate.h / 2;
        return localX >= left && localX <= right && localY >= bottom && localY <= top;
    }

    private createNode(name: string, parent: Node, x: number, y: number, width: number, height: number) {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        node.setPosition(new Vec3(x, y, 0));
        parent.addChild(node);
        return node;
    }

    private createPlateNode(parent: Node, plate: PlateData, interactive: boolean, angleOverride?: number) {
        let pivotX = plate.x;
        let pivotY = plate.y;
        let offsetX = 0;
        let offsetY = 0;

        if (plate.gravityOrigin) {
            offsetX = plate.gravityOrigin.x - plate.w / 2;
            offsetY = plate.h / 2 - plate.gravityOrigin.y;
            pivotX = plate.x + offsetX;
            pivotY = plate.y + offsetY;
        }

        const pivotNode = this.createNode(`Pivot_${plate.id}`, parent, pivotX, pivotY, 0, 0);
        pivotNode.angle = angleOverride ?? (plate.rotation || 0);
        if (interactive) {
            this.plateNodes.set(plate.id, pivotNode);
            pivotNode.setSiblingIndex(Math.max(0, this.getPlateSiblingIndex(plate.id)));
        }

        const plateNode = this.createNode(`PlateVisual_${plate.id}`, pivotNode, -offsetX, -offsetY, plate.w, plate.h);

        const shadow = this.createGraphicsNode('Shadow', plateNode, plate.w + 6, plate.h + 6, 6, -6);
        this.drawPlateShape(shadow.getComponent(Graphics)!, plate.type, plate.w + 6, plate.h + 6, new Color(162, 176, 190, 105), 24, 0);

        const face = this.createGraphicsNode('Face', plateNode, plate.w, plate.h, 0, 0);
        this.drawPlateShape(face.getComponent(Graphics)!, plate.type, plate.w, plate.h, FACE_COLORS[plate.color], 22, 5, new Color(245, 248, 250, 230));

        plate.screws.filter((screw) => !screw.removed).forEach((screw) => {
            const screwSize = 34;
            const localX = -plate.w / 2 + screw.x;
            const localY = plate.h / 2 - screw.y;

            const screwContainer = this.createNode(`ScrewContainer_${screw.id}`, plateNode, localX, localY, screwSize, screwSize);

            const holeShadow = this.createGraphicsNode('Hole', screwContainer, screwSize, screwSize, 0, 0);
            this.drawCircle(holeShadow.getComponent(Graphics)!, screwSize / 2, new Color(0, 0, 0, 40), 0);

            const screwNode = this.createScrewVisual(screwContainer, 0, 0, screwSize, screw.color, true);
            if (interactive) {
                screwNode.on(Node.EventType.TOUCH_END, (e) => {
                    e.propagationStopped = true;
                    this.handleScrewClick(plate, screw);
                }, this);
            }
        });

        return pivotNode;
    }

    private refreshPlateNode(plate: PlateData, angleOverride?: number) {
        if (!this.boardContentNode || plate.removed) return null;
        this.destroyPlateNode(plate.id);
        return this.createPlateNode(this.boardContentNode, plate, true, angleOverride);
    }

    private destroyPlateNode(plateId: string) {
        const node = this.plateNodes.get(plateId);
        if (node && node.isValid) {
            node.destroy();
        }
        this.plateNodes.delete(plateId);
    }

    private getPlateSiblingIndex(plateId: string) {
        return this.plates
            .filter((plate) => !plate.removed)
            .sort((a, b) => a.layer - b.layer)
            .findIndex((plate) => plate.id === plateId);
    }

    private updateScrewHost(host: Node, diameter: number, color?: ScrewColor) {
        const existing = host.children[0];
        const expectedName = color ? `ScrewVisual_${color}` : '';
        if (!color) {
            if (existing) {
                host.removeAllChildren();
            }
            return;
        }

        if (existing && existing.name === expectedName) {
            return;
        }

        host.removeAllChildren();
        this.createScrewVisual(host, 0, 0, diameter, color, false);
    }

    private getBoxSlotPositions() {
        return [
            { x: -16, y: 13 },
            { x: 16, y: 13 },
            { x: 0, y: -12 }
        ];
    }

    private ensureBoxViews() {
        if (!this.boxesContainerNode || this.boxViews.length === this.boxes.length) return;

        const boxWidth = Math.min(84, this.screenWidth * 0.2);
        const boxHeight = 92;
        const gap = (this.screenWidth - 40 - boxWidth * 4) / 3;
        const startX = -((boxWidth * 4 + gap * 3) / 2) + boxWidth / 2;
        const slotPositions = this.getBoxSlotPositions();

        while (this.boxViews.length < this.boxes.length) {
            const index = this.boxViews.length;
            const x = startX + index * (boxWidth + gap);
            const boxNode = this.createNode(`Box_${index}`, this.boxesContainerNode, x, 0, boxWidth, boxHeight);

            const backLayer = this.createGraphicsNode('BackLayer', boxNode, boxWidth + 8, boxHeight + 8, 5, -4);
            this.drawRoundedRect(backLayer.getComponent(Graphics)!, boxWidth + 8, boxHeight + 8, new Color(198, 208, 220, 170), 12);

            const shadow = this.createGraphicsNode('Shadow', boxNode, boxWidth + 6, boxHeight + 6, 2, -2);
            this.drawRoundedRect(shadow.getComponent(Graphics)!, boxWidth + 6, boxHeight + 6, new Color(210, 218, 228, 120), 12);

            const body = this.createGraphicsNode('Body', boxNode, boxWidth, boxHeight, 0, 0);
            const bodyGraphics = body.getComponent(Graphics)!;

            const lockLabel = this.createLabel(boxNode, '解锁\n盒子', 0, 0, 15, new Color(255, 255, 255, 255), true, 19);
            lockLabel.node.active = false;

            const slots: BoxSlotView[] = slotPositions.map((pos, slotIndex) => {
                const slotNode = this.createNode(`SlotWrap_${slotIndex}`, boxNode, pos.x, pos.y, 24, 24);
                const holeNode = this.createGraphicsNode(`Slot_${slotIndex}`, slotNode, 24, 24, 0, 0);
                const hole = holeNode.getComponent(Graphics)!;
                this.drawCircle(hole, 12, new Color(0, 0, 0, 35), 0);
                const screwHost = this.createNode(`ScrewHost_${slotIndex}`, slotNode, 0, 0, 24, 24);
                return { node: slotNode, hole, screwHost };
            });

            boxNode.on(Node.EventType.TOUCH_END, () => {
                const box = this.boxes[index];
                if (box && box.color === 'locked') {
                    this.handleUnlockBox(box);
                }
            }, this);

            this.boxViews.push({
                node: boxNode,
                body: bodyGraphics,
                lockLabel,
                slots
            });
        }
    }

    private ensureTempSlotViews() {
        if (!this.tempContainerNode) return;

        if (!this.tempBgGraphics) {
            const containerW = this.screenWidth - 154;
            const containerH = 30;
            const bgNode = this.createGraphicsNode('TempBg', this.tempContainerNode, containerW, containerH, 0, 0);
            this.tempBgGraphics = bgNode.getComponent(Graphics)!;
        }

        if (this.tempSlotViews.length === this.maxTempHoles) return;

        const slotRadius = 12;
        const spacing = slotRadius * 2 + 5;
        const startX = -spacing * 2;
        while (this.tempSlotViews.length < this.maxTempHoles) {
            const index = this.tempSlotViews.length;
            const slotNode = this.createNode(`TempSlotWrap_${index}`, this.tempContainerNode, startX + index * spacing, 0, slotRadius * 2, slotRadius * 2);
            const holeNode = this.createGraphicsNode(`TempSlot_${index}`, slotNode, slotRadius * 2, slotRadius * 2, 0, 0);
            const hole = holeNode.getComponent(Graphics)!;
            this.drawCircle(hole, slotRadius, new Color(202, 206, 212, 255), 0);
            const screwHost = this.createNode(`TempScrewHost_${index}`, slotNode, 0, 0, slotRadius * 2, slotRadius * 2);
            this.tempSlotViews.push({ node: slotNode, hole, screwHost });
        }
    }

    private ensureToolViews() {
        if (!this.toolContainerNode || this.toolViews.length > 0) return;

        const toolList = [
            { key: 'add' as const, label: '加孔位', icon: '🔍' },
            { key: 'break' as const, label: '熔玻璃', icon: '🔨' },
            { key: 'clear' as const, label: '清空孔位', icon: '🧹' }
        ];
        const buttonWidth = 74;
        const buttonHeight = 82;
        const gap = (this.screenWidth - 40 - buttonWidth * 3) / 2;
        const startX = -((buttonWidth * 3 + gap * 2) / 2) + buttonWidth / 2;
        const badgeX = buttonWidth / 2 - 6;
        const badgeY = buttonHeight / 2 - 6;

        toolList.forEach((tool, index) => {
            const x = startX + index * (buttonWidth + gap);
            const btnNode = this.createNode(`ToolBtn_${tool.key}`, this.toolContainerNode!, x, 0, buttonWidth, buttonHeight);

            const shadow = this.createGraphicsNode('Shadow', btnNode, buttonWidth + 6, buttonHeight + 6, 0, -2);
            this.drawRoundedRect(shadow.getComponent(Graphics)!, buttonWidth + 6, buttonHeight + 6, new Color(201, 218, 234, 255), 18);

            const body = this.createGraphicsNode('Body', btnNode, buttonWidth, buttonHeight, 0, 0);
            this.drawRoundedRect(body.getComponent(Graphics)!, buttonWidth, buttonHeight, new Color(138, 77, 232, 255), 16, 5, new Color(175, 133, 240, 255));

            const iconLabel = this.createLabel(btnNode, tool.icon, 0, 8, 28, new Color(255, 255, 255, 255), false, 32);
            iconLabel.enableWrapText = false;
            this.createLabel(btnNode, tool.label, 0, -22, 15, new Color(255, 255, 255, 255), true);

            const badgeNode = this.createGraphicsNode('Badge', btnNode, 26, 26, badgeX, badgeY);
            const badge = badgeNode.getComponent(Graphics)!;
            const badgeLabel = this.createLabel(btnNode, '+', badgeX, badgeY, 18, new Color(255, 255, 255, 255), true);

            btnNode.on(Node.EventType.TOUCH_END, () => {
                this.useTool(tool.key);
            }, this);

            this.toolViews.push({
                key: tool.key,
                node: btnNode,
                iconLabel,
                badge,
                badgeLabel
            });
        });
    }

    private createGraphicsNode(name: string, parent: Node, width: number, height: number, x: number, y: number) {
        const node = this.createNode(name, parent, x, y, width, height);
        node.addComponent(Graphics);
        return node;
    }

    private createLabel(parent: Node, text: string, x: number, y: number, fontSize: number, color: Color, bold = false, lineHeight?: number) {
        const node = this.createNode('Label', parent, x, y, 200, 60);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = lineHeight || fontSize + 6;
        label.color = color;
        label.horizontalAlign = 1;
        label.verticalAlign = 1;
        label.isBold = bold;
        return label;
    }

    private createIconButton(parent: Node, x: number, y: number, width: number, height: number, text: string, fontSize: number) {
        const node = this.createNode('IconButton', parent, x, y, width, height);
        const bg = this.createGraphicsNode('Bg', node, width, height, 0, 0);
        this.drawRoundedRect(bg.getComponent(Graphics)!, width, height, new Color(255, 255, 255, 255), 14);
        this.createLabel(node, text, 0, 0, fontSize, new Color(31, 35, 42, 255), true);
        return node;
    }

    private triggerVibration(type: 'light' | 'heavy' | 'success' = 'light') {
        const wxApi = (globalThis as any).wx;
        if (wxApi && typeof wxApi.vibrateShort === 'function') {
            try {
                if (type === 'success') {
                    wxApi.vibrateShort({});
                    setTimeout(() => wxApi.vibrateShort({}), 70);
                } else if (type === 'heavy') {
                    wxApi.vibrateShort({ type: 'heavy' });
                } else {
                    wxApi.vibrateShort({});
                }
                return;
            } catch (_) {
                // ignore and fallback below
            }
        }

        const nav = (globalThis as any).navigator;
        if (nav && typeof nav.vibrate === 'function') {
            if (type === 'success') {
                nav.vibrate([35, 40, 35]);
            } else if (type === 'heavy') {
                nav.vibrate(45);
            } else {
                nav.vibrate(20);
            }
        }
    }

    private createSettingsButton(parent: Node, x: number, y: number, width: number, height: number) {
        const node = this.createNode('SettingsButton', parent, x, y, width, height);
        const bg = this.createGraphicsNode('Bg', node, width, height, 0, 0);
        this.drawRoundedRect(bg.getComponent(Graphics)!, width, height, new Color(255, 255, 255, 255), 20, 2, new Color(214, 219, 226, 255));
        [-18, 0, 18].forEach((dotX) => {
            const dot = this.createGraphicsNode('Dot', node, 8, 8, dotX, 0);
            this.drawCircle(dot.getComponent(Graphics)!, 4, new Color(21, 25, 31, 255), 0);
        });
        const ring = this.createGraphicsNode('Ring', node, 18, 18, 28, 0);
        const ringGraphics = ring.getComponent(Graphics)!;
        ringGraphics.clear();
        ringGraphics.lineWidth = 4;
        ringGraphics.strokeColor = new Color(21, 25, 31, 255);
        ringGraphics.circle(0, 0, 7);
        ringGraphics.stroke();
        return node;
    }

    private createScrewVisual(parent: Node, x: number, y: number, diameter: number, color: ScrewColor, addShadow: boolean = true): Node {
        const screwNode = this.createNode(`ScrewVisual_${color}`, parent, x, y, diameter, diameter);

        if (addShadow) {
            const shadow = this.createGraphicsNode('Shadow', screwNode, diameter, diameter, 0, -4);
            this.drawCircle(shadow.getComponent(Graphics)!, diameter / 2, new Color(0, 0, 0, 60), 0);
        }

        const body = this.createGraphicsNode('Body', screwNode, diameter - 2, diameter - 2, 0, 0);
        this.drawCircle(body.getComponent(Graphics)!, (diameter - 2) / 2, SCREW_FACE_COLORS[color], 2, new Color(248, 244, 235, 245));

        const innerBody = this.createGraphicsNode('InnerBody', screwNode, diameter - 8, diameter - 8, 0, 1);
        this.drawCircle(innerBody.getComponent(Graphics)!, (diameter - 8) / 2, BOX_COLORS[color], 1, new Color(255, 255, 255, 80));

        const highlight = this.createGraphicsNode('Highlight', screwNode, Math.max(8, diameter * 0.34), Math.max(8, diameter * 0.22), -diameter * 0.12, diameter * 0.14);
        this.drawCircle(highlight.getComponent(Graphics)!, Math.max(4, diameter * 0.11), new Color(255, 255, 255, 70), 0);

        const crossColor = color === ScrewColor.YELLOW ? new Color(104, 82, 28, 220) : new Color(74, 33, 40, 220);
        const cross = this.createLabel(screwNode, '+', 0, 1, diameter - 10, crossColor, true, diameter);
        cross.getComponent(Label)!.isBold = true;

        return screwNode;
    }

    private drawRoundedRect(graphics: Graphics, width: number, height: number, fill: Color, radius: number, lineWidth = 0, stroke?: Color) {
        graphics.clear();
        graphics.fillColor = fill;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.fill();
        if (lineWidth > 0 && stroke) {
            graphics.lineWidth = lineWidth;
            graphics.strokeColor = stroke;
            graphics.roundRect(-width / 2, -height / 2, width, height, radius);
            graphics.stroke();
        }
    }

    private drawCircle(graphics: Graphics, radius: number, fill: Color, lineWidth = 0, stroke?: Color) {
        graphics.clear();
        graphics.fillColor = fill;
        graphics.circle(0, 0, radius);
        graphics.fill();
        if (lineWidth > 0 && stroke) {
            graphics.lineWidth = lineWidth;
            graphics.strokeColor = stroke;
            graphics.circle(0, 0, radius);
            graphics.stroke();
        }
    }

    private drawPlateShape(graphics: Graphics, type: 'circle' | 'rect', width: number, height: number, fill: Color, radius: number, lineWidth: number, stroke?: Color) {
        graphics.clear();
        if (type === 'circle') {
            this.drawCircle(graphics, Math.min(width, height) / 2, fill, lineWidth, stroke);
            return;
        }
        this.drawRoundedRect(graphics, width, height, fill, radius, lineWidth, stroke);
    }

    private getBoxColor(color: BoxColor): Color {
        return BOX_COLORS[color] || new Color(200, 200, 200, 255);
    }
}
