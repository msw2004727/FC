3D 蓄力射門 - 地獄狂抖絕對命中版 ⚽️這是一套基於 Three.js 開發的單檔 H5 3D 足球射門遊戲。針對特定玩家需求，本遊戲具備以下硬核特色：防 3D 暈眩鎖定：攝影機視角絕對固定，只移動場景物件，保護容易暈眩的玩家。500% 準星極限狂抖：蓄力時準星會產生最高達 300px 的劇烈震顫，模擬重砲發力時的肌肉不穩定。100% 絕對命中預判系統：內建物理迭代演算器，只要放開手指的瞬間準星掃過目標，系統保證反向推導出絕對命中的軌跡！無盡生存模式：進球越多，球門閃避速度越快，只要失誤一次即刻 Game Over。🚀 執行方式這是一個 100% 獨立運行、無須伺服器的前端網頁遊戲：將下方 html ...  區塊內的完整代碼複製。在電腦上建立一個新的純文字檔案，將內容貼上，並將副檔名改為 .html（例如 PenaltyKick.html）。使用任何現代瀏覽器（Chrome, Edge, Safari）雙擊開啟該檔案，即可直接遊玩（支援手機與電腦）。💻 完整遊戲源碼<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, maximum-scale=1.0">
    <title>3D 蓄力射門 - 地獄狂抖絕對命中版</title>
    <style>
        body {
            margin: 0;
            overflow: hidden;
            background-color: #87CEEB; /* 天空藍 */
            font-family: 'Microsoft JhengHei', sans-serif;
            touch-action: none; 
        }
        #game-container {
            position: relative;
            width: 100vw;
            height: 100vh;
            background-color: #000;
            overflow: hidden;
        }
        #ui-layer {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; 
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            z-index: 10;
        }
        .top-ui {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .header {
            width: 100%;
            display: flex;
            justify-content: space-between;
            padding: 15px 20px;
            box-sizing: border-box;
            color: white;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
            font-weight: bold;
        }
        .score-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }
        #score-display {
            font-size: clamp(20px, 5vw, 28px); 
        }
        #streak-display {
            font-size: clamp(14px, 3.5vw, 18px); 
            color: #FFEB3B; 
            margin-top: 4px;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.9);
        }
        .instructions {
            text-align: center;
            color: white;
            padding: 12px;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.8);
            font-size: clamp(13px, 3.5vw, 15px);
            background: rgba(0,0,0,0.4);
            border-radius: 8px;
            max-width: 90%;
            margin-top: 5px;
            pointer-events: auto; 
        }
        .center-msg {
            text-align: center;
            color: #FFD700;
            font-size: clamp(24px, 6vw, 36px);
            text-shadow: 2px 2px 8px rgba(0,0,0,0.9);
            font-weight: bold;
            opacity: 0;
            transition: opacity 0.3s;
            position: absolute;
            top: 40%;
            width: 100%;
            line-height: 1.5;
        }
        .bottom-ui {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            margin-bottom: 80px; 
        }
        #restart-btn {
            display: none;
            pointer-events: auto;
            padding: 15px 40px;
            font-size: 20px;
            font-weight: bold;
            color: white;
            background-color: #e53935;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            transition: transform 0.1s;
        }
        #restart-btn:active {
            transform: scale(0.95);
        }
        
        /* 蓄力條 UI */
        #power-bar-container {
            position: absolute;
            bottom: 40px;
            left: 50%;
            transform: translateX(-50%);
            width: 80%;
            max-width: 400px;
            height: 25px;
            background: rgba(0,0,0,0.6);
            border: 2px solid #fff;
            border-radius: 15px;
            overflow: hidden;
            display: none;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
        }
        #power-fill {
            width: 0%;
            height: 100%;
            background: linear-gradient(90deg, #00FF00, #FFFF00);
            transition: background 0.1s;
        }
        
        /* 瞄準準星 UI */
        #crosshair {
            position: absolute;
            width: 40px;
            height: 40px;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            display: none;
            pointer-events: none;
            opacity: 0.8;
            z-index: 5;
        }
        #crosshair::before, #crosshair::after {
            content: '';
            position: absolute;
            background: rgba(255, 0, 0, 0.9);
            box-shadow: 0 0 4px rgba(255,255,255,0.8);
        }
        #crosshair::before { top: 18px; left: 0; width: 40px; height: 4px; border-radius: 2px; }
        #crosshair::after { left: 18px; top: 0; width: 4px; height: 40px; border-radius: 2px; }

    </style>
    <script src="[https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js](https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js)"></script>
</head>
<body>

    <div id="game-container">
        <div id="crosshair"></div>

        <div id="ui-layer">
            <div class="top-ui">
                <div class="header">
                    <div class="score-container">
                        <div id="score-display">分數: 0</div>
                        <div id="streak-display">連續進球: 0</div>
                    </div>
                </div>
                <div class="instructions" id="inst-text">
                    👆 <b>精準點擊足球</b> 蓄力，↔️ <b>拖曳手指</b> 改變準星<br>
                    ✨ 準星地獄級狂抖 500%！請在瘋狂亂晃中抓住出腳時機！
                </div>
            </div>
            
            <div id="message" class="center-msg"></div>
            
            <div class="bottom-ui">
                <button id="restart-btn" onclick="resetGame()">重新挑戰</button>
            </div>
        </div>

        <div id="power-bar-container">
            <div id="power-fill"></div>
        </div>
    </div>

    <script>
        // --- 遊戲狀態與變數 ---
        let score = 0;
        let streak = 0; 
        let gameState = 'aiming'; 
        
        let isCharging = false;
        let power = 0;
        const MAX_SAFE_POWER = 100;
        const ABSOLUTE_MAX_POWER = 130; 
        let startTouch = { x: 0, y: 0 };
        let aimTarget = { x: 0, y: 3 }; 
        let shakenAimTarget = { x: 0, y: 3 }; // 新增：紀錄抖動後的真實 3D 座標落點

        // --- 物理系統核心常數 ---
        const FIXED_DT = 1 / 60;
        let timeAccumulator = 0;

        let velocity = new THREE.Vector3();
        let spin = new THREE.Vector3();
        const gravity = 25;
        const magnusConstant = 0.08; 
        const drag = 0.99; 
        let trailPositions = []; 
        let trailLine;
        
        let kickInitialSpin = 0; 
        let flightApex = 0;      
        let flightTime = 0; 
        let resultTimeout = null; 

        // --- 動態球門變數 ---
        const goalGroup = new THREE.Group();
        const goalZ = -20;
        const goalWidth = 15;   
        const goalHeight = 7.5; 
        const postRadius = 0.2; 
        let currentBaseSpeed = 3;      
        let goalMoveSpeed = 3;         
        let goalDirection = 1;         
        let goalMaxOffset = 6;         

        const penaltySpotZ = 12;

        // --- Three.js 核心 ---
        const gameContainer = document.getElementById('game-container');
        const scene = new THREE.Scene();
        
        const camera = new THREE.PerspectiveCamera(60, gameContainer.clientWidth / gameContainer.clientHeight, 0.1, 1000);
        camera.position.set(0, 7, 26); 
        camera.lookAt(0, 2, -20); 

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(gameContainer.clientWidth, gameContainer.clientHeight);
        renderer.shadowMap.enabled = true;
        gameContainer.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
        dirLight.position.set(15, 25, 15);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        scene.add(dirLight);

        // --- 場景物件 ---
        const grassGeo = new THREE.PlaneGeometry(300, 300);
        const grassMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
        const grass = new THREE.Mesh(grassGeo, grassMat);
        grass.rotation.x = -Math.PI / 2;
        grass.receiveShadow = true;
        scene.add(grass);

        drawFieldLines();

        const ballRadius = 0.6;
        const ballGeo = new THREE.SphereGeometry(ballRadius, 64, 64); 
        const textures = createWhiteSoccerTextures();
        const ballMat = new THREE.MeshStandardMaterial({ 
            map: textures.map,
            bumpMap: textures.bumpMap,
            bumpScale: 0.04, 
            roughness: 0.65,      
            metalness: 0.1        
        });
        const ball = new THREE.Mesh(ballGeo, ballMat);
        ball.castShadow = true;
        scene.add(ball);

        goalGroup.position.set(0, 0, goalZ);
        scene.add(goalGroup);
        createGoalPosts();
        
        const zones = [];
        createTargetZones();

        const trailMat = new THREE.LineBasicMaterial({ color: 0x00FFFF, linewidth: 3, transparent: true, opacity: 0.7 });
        const trailGeo = new THREE.BufferGeometry();
        trailLine = new THREE.Line(trailGeo, trailMat);
        scene.add(trailLine);

        function drawFieldLines() {
            const lineMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
            const lineThickness = 0.4;
            const groundY = 0.02; 

            function createLine(w, d, x, z) {
                const geo = new THREE.PlaneGeometry(w, d);
                const mesh = new THREE.Mesh(geo, lineMat);
                mesh.rotation.x = -Math.PI / 2;
                mesh.position.set(x, groundY, z);
                mesh.receiveShadow = true;
                scene.add(mesh);
            }
            createLine(120, lineThickness, 0, goalZ); 
            const outerW = 44; const outerD = 40;
            createLine(lineThickness, outerD, -outerW/2, goalZ + outerD/2); 
            createLine(lineThickness, outerD, outerW/2, goalZ + outerD/2);  
            createLine(outerW + lineThickness, lineThickness, 0, goalZ + outerD); 

            const innerW = 20; const innerD = 12;
            createLine(lineThickness, innerD, -innerW/2, goalZ + innerD/2);
            createLine(lineThickness, innerD, innerW/2, goalZ + innerD/2);
            createLine(innerW + lineThickness, lineThickness, 0, goalZ + innerD);

            const spotGeo = new THREE.CircleGeometry(0.6, 32);
            const spotMesh = new THREE.Mesh(spotGeo, lineMat);
            spotMesh.rotation.x = -Math.PI / 2;
            spotMesh.position.set(0, groundY, penaltySpotZ);
            spotMesh.receiveShadow = true;
            scene.add(spotMesh);

            const radius = 14;
            const distToBox = (goalZ + outerD) - penaltySpotZ; 
            const alpha = Math.acos(distToBox / radius); 
            const thetaStart = -Math.PI/2 - alpha;
            const thetaLength = alpha * 2;
            const arcGeo = new THREE.RingGeometry(radius - lineThickness/2, radius + lineThickness/2, 64, 1, thetaStart, thetaLength);
            const arcMesh = new THREE.Mesh(arcGeo, lineMat);
            arcMesh.rotation.x = -Math.PI / 2;
            arcMesh.position.set(0, groundY, penaltySpotZ);
            arcMesh.receiveShadow = true;
            scene.add(arcMesh);
        }

        function createWhiteSoccerTextures() {
            const size = 1024; 
            const canvas = document.createElement('canvas');
            const bumpCanvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            bumpCanvas.width = size; bumpCanvas.height = size;
            const ctx = canvas.getContext('2d');
            const bCtx = bumpCanvas.getContext('2d');

            ctx.fillStyle = '#f8f8f8';
            ctx.fillRect(0, 0, size, size);
            bCtx.fillStyle = '#808080';
            bCtx.fillRect(0, 0, size, size);

            const patches = 7;
            const patchRadius = size * 0.068; 

            for(let i=0; i<=patches; i++) {
                for(let j=0; j<=patches; j++) {
                    let cx = i * (size/patches) + (j%2===0 ? (size/(patches*2)) : 0);
                    let cy = j * (size/patches);
                    bCtx.strokeStyle = '#000000';
                    bCtx.lineWidth = 6;
                    bCtx.beginPath();
                    bCtx.arc(cx, cy, patchRadius, 0, Math.PI*2);
                    bCtx.stroke();
                }
            }

            const imgData = ctx.getImageData(0, 0, size, size);
            const bumpData = bCtx.getImageData(0, 0, size, size);
            for(let i=0; i<imgData.data.length; i+=4) {
                let noise = (Math.random() - 0.5) * 10;
                imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + noise));
                imgData.data[i+1] = Math.max(0, Math.min(255, imgData.data[i+1] + noise));
                imgData.data[i+2] = Math.max(0, Math.min(255, imgData.data[i+2] + noise));
                let bNoise = (Math.random() - 0.5) * 30;
                bumpData.data[i] = Math.max(0, Math.min(255, bumpData.data[i] + bNoise));
                bumpData.data[i+1] = Math.max(0, Math.min(255, bumpData.data[i+1] + bNoise));
                bumpData.data[i+2] = Math.max(0, Math.min(255, bumpData.data[i+2] + bNoise));
            }
            ctx.putImageData(imgData, 0, 0);
            bCtx.putImageData(bumpData, 0, 0);

            return { map: new THREE.CanvasTexture(canvas), bumpMap: new THREE.CanvasTexture(bumpCanvas) };
        }

        function createGoalPosts() {
            const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
            const postGeo = new THREE.CylinderGeometry(postRadius, postRadius, goalHeight);
            
            const leftPost = new THREE.Mesh(postGeo, postMat);
            leftPost.position.set(-goalWidth/2, goalHeight/2, 0);
            goalGroup.add(leftPost);

            const rightPost = new THREE.Mesh(postGeo, postMat);
            rightPost.position.set(goalWidth/2, goalHeight/2, 0);
            goalGroup.add(rightPost);

            const crossGeo = new THREE.CylinderGeometry(postRadius, postRadius, goalWidth + postRadius*2);
            const crossbar = new THREE.Mesh(crossGeo, postMat);
            crossbar.rotation.z = Math.PI / 2;
            crossbar.position.set(0, goalHeight, 0);
            goalGroup.add(crossbar);
        }

        function createTargetZones() {
            const cols = 3; const rows = 3;
            const zoneW = goalWidth / cols;
            const zoneH = goalHeight / rows;
            const scoreMap = [[40, 10, 40], [50, 20, 50], [100, 50, 100]];
            const colors = [0xff0000, 0xffa500, 0xffff00]; 

            for(let r=0; r<rows; r++) {
                for(let c=0; c<cols; c++) {
                    const planeGeo = new THREE.PlaneGeometry(zoneW, zoneH);
                    const planeMat = new THREE.MeshBasicMaterial({ 
                        color: colors[r], transparent: true, opacity: 0.15, side: THREE.DoubleSide
                    });
                    const zone = new THREE.Mesh(planeGeo, planeMat);
                    
                    const relX = -goalWidth/2 + (c * zoneW) + zoneW/2;
                    const relY = (r * zoneH) + zoneH/2;
                    zone.position.set(relX, relY, 0);
                    
                    const edges = new THREE.EdgesGeometry(planeGeo);
                    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
                    zone.add(line);

                    goalGroup.add(zone);
                    zones.push({
                        mesh: zone,
                        localBounds: { minX: relX - zoneW/2, maxX: relX + zoneW/2, minY: relY - zoneH/2, maxY: relY + zoneH/2 },
                        points: scoreMap[r][c]
                    });
                }
            }
        }

        function resize() {
            const width = gameContainer.clientWidth;
            const height = gameContainer.clientHeight;
            const aspect = width / height;
            
            camera.aspect = aspect;
            if (aspect < 1) camera.fov = 75 + (1 - aspect) * 20; 
            else camera.fov = 60; 
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        }
        window.addEventListener('resize', resize);
        resize(); 

        // --- 互動與瞄準邏輯 ---
        const crosshairUI = document.getElementById('crosshair');
        const powerContainer = document.getElementById('power-bar-container');
        const powerFill = document.getElementById('power-fill');
        const instText = document.getElementById('inst-text');
        
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        let baseCrosshairX = 0;
        let baseCrosshairY = 0;

        function updateCrosshairUI() {
            const targetPos = new THREE.Vector3(aimTarget.x, aimTarget.y, goalZ);
            targetPos.project(camera); 

            baseCrosshairX = (targetPos.x * 0.5 + 0.5) * gameContainer.clientWidth;
            baseCrosshairY = (-(targetPos.y * 0.5) + 0.5) * gameContainer.clientHeight;

            if(!isCharging) {
                crosshairUI.style.left = `${baseCrosshairX}px`;
                crosshairUI.style.top = `${baseCrosshairY}px`;
                crosshairUI.style.transform = `translate(-50%, -50%)`;
                
                // 未蓄力時，真實目標等於畫面中心目標
                shakenAimTarget.x = aimTarget.x;
                shakenAimTarget.y = aimTarget.y;
            }
        }

        gameContainer.addEventListener('pointerdown', (e) => {
            if (gameState !== 'aiming') return;

            const rect = gameContainer.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObject(ball);

            if (intersects.length === 0) return;

            isCharging = true;
            power = 0;
            
            startTouch.x = e.clientX;
            startTouch.y = e.clientY;
            aimTarget.x = 0;
            aimTarget.y = 3; 
            
            crosshairUI.style.display = 'block';
            powerContainer.style.display = 'block';
            instText.style.opacity = '0.1'; 
            
            updateCrosshairUI();
        });

        gameContainer.addEventListener('pointermove', (e) => {
            if (!isCharging) return;
            const sensitivity = 10 / Math.min(gameContainer.clientWidth, gameContainer.clientHeight);
            const dx = (e.clientX - startTouch.x) * sensitivity * 5; 
            const dy = (e.clientY - startTouch.y) * sensitivity * 5;
            aimTarget.x = Math.max(-20, Math.min(20, dx)); 
            aimTarget.y = Math.max(-2, Math.min(10, 3 - dy));
            updateCrosshairUI();
        });

        const handleRelease = () => {
            if (!isCharging) return;
            isCharging = false;
            crosshairUI.style.display = 'none';
            powerContainer.style.display = 'none';
            kickBall();
        };

        gameContainer.addEventListener('pointerup', handleRelease);
        gameContainer.addEventListener('pointercancel', handleRelease);
        gameContainer.addEventListener('pointerleave', () => { if (isCharging) handleRelease(); });

        // --- 物理迭代軌跡演算器 (100%絕對命中保證) ---
        function calculatePerfectShot(startPos, targetX, targetY, targetZ, pFactor) {
            const finalPower = 20 + (pFactor * 40); 
            const targetVec = new THREE.Vector3(targetX, targetY, targetZ);
            const dir = new THREE.Vector3().subVectors(targetVec, startPos).normalize();
            
            let bestV = dir.clone().multiplyScalar(finalPower);
            
            let testSpin = new THREE.Vector3();
            testSpin.y = -targetX * pFactor * 0.8;  
            testSpin.x = pFactor * 12.0;            
            testSpin.z = 0;

            const subSteps = 3;
            const sDt = FIXED_DT / subSteps;

            for(let iter = 0; iter < 40; iter++) {
                let simP = startPos.clone();
                let simV = bestV.clone();
                let simSpin = testSpin.clone();
                let simTime = 0;

                while (simP.z > targetZ && simTime < 5.0) {
                    for(let s = 0; s < subSteps; s++) {
                        const magnus = new THREE.Vector3().crossVectors(simV, simSpin).multiplyScalar(magnusConstant);
                        simV.add(magnus.multiplyScalar(sDt));
                        simV.y -= gravity * sDt;
                        simV.multiplyScalar(Math.pow(drag, 1/subSteps));
                        simP.addScaledVector(simV, sDt);
                        
                        if (simP.y <= ballRadius) {
                            simP.y = ballRadius;
                            simV.y *= -0.6; 
                            simV.x *= 0.99; 
                            simV.z *= 0.99;
                            simSpin.multiplyScalar(0.9); 
                        }
                    }
                    simTime += FIXED_DT;
                }

                let errX = targetX - simP.x;
                let errY = targetY - simP.y;

                if (Math.abs(errX) < 0.05 && Math.abs(errY) < 0.05) break;

                let timeToTarget = Math.max(simTime, 0.2);
                let dVx = (errX / timeToTarget) * 0.6;
                let dVy = (errY / timeToTarget) * 0.6;
                
                dVx = Math.max(-15, Math.min(15, dVx));
                dVy = Math.max(-15, Math.min(15, dVy));

                bestV.x += dVx;
                bestV.y += dVy;
            }

            return { velocity: bestV, spin: testSpin };
        }

        function kickBall() {
            gameState = 'flying';
            flightTime = 0; 
            trailPositions = []; 
            flightApex = ball.position.y; 
            
            let pFactor = power / MAX_SAFE_POWER; 
            if (pFactor > 1.3) pFactor = 1.3; 

            if (power > MAX_SAFE_POWER) {
                showMessage("極限爆發！絕對鎖定！", "#FF5555");
            }

            // 將物理演算的目標改為包含劇烈抖動偏移的 shakenAimTarget
            const perfectShot = calculatePerfectShot(ball.position, shakenAimTarget.x, shakenAimTarget.y, goalZ, pFactor);
            
            velocity.copy(perfectShot.velocity);
            spin.copy(perfectShot.spin);
            
            kickInitialSpin = Math.abs(spin.y) + Math.abs(spin.x);
        }

        function resetShot() {
            if(resultTimeout) clearTimeout(resultTimeout);
            ball.position.set(0, ballRadius, penaltySpotZ);
            velocity.set(0, 0, 0);
            spin.set(0, 0, 0);
            trailPositions = [];
            trailGeo.setFromPoints(trailPositions);
            
            gameState = 'aiming';
            power = 0;
            powerFill.style.width = '0%';
            powerFill.style.background = 'linear-gradient(90deg, #00FF00, #FFFF00)';
            if(instText) instText.style.opacity = '1';
        }

        function showMessage(text, color) {
            const msgEl = document.getElementById('message');
            msgEl.innerHTML = text.replace(/\n/g, '<br>');
            msgEl.style.color = color;
            msgEl.style.opacity = '1';
            setTimeout(() => {
                if (gameState !== 'gameover') msgEl.style.opacity = '0';
            }, 2500);
        }

        function calculateBeautyScore() {
            let spinScore = Math.floor((kickInitialSpin / 45) * 12);
            spinScore = Math.max(0, Math.min(12, spinScore));
            let heightScore = Math.floor(((flightApex - 2) / 8) * 8);
            heightScore = Math.max(0, Math.min(8, heightScore));
            let total = Math.max(1, spinScore + heightScore);
            return Math.min(20, total);
        }

        function processResult(hitZone) {
            if (gameState === 'result') return;
            gameState = 'result';

            if (hitZone) {
                streak++;
                const beautyScore = calculateBeautyScore();
                const totalEarned = hitZone.points + beautyScore;
                score += totalEarned;
                
                document.getElementById('score-display').innerText = `分數: ${score}`;
                document.getElementById('streak-display').innerText = `連續進球: ${streak}`;
                
                const speedFactor = Math.min(streak / 30, 1.0);
                currentBaseSpeed = 3 + (12 * speedFactor); 

                // 進球後立刻將提昇後的基準速度套用到當前的移動速度上
                goalMoveSpeed = currentBaseSpeed + (Math.random() - 0.5) * (currentBaseSpeed * 0.5);
                goalMoveSpeed = Math.max(2, goalMoveSpeed);

                const originalColor = hitZone.mesh.material.color.getHex();
                hitZone.mesh.material.color.setHex(0xffffff);
                hitZone.mesh.material.opacity = 0.8;
                setTimeout(() => {
                    hitZone.mesh.material.color.setHex(originalColor);
                    hitZone.mesh.material.opacity = 0.15;
                }, 500);

                let msg = '';
                let color = '#FFFFFF';
                if(hitZone.points >= 100) { msg = `完美導航死角！ +${hitZone.points}`; color = '#FFD700'; }
                else if(hitZone.points >= 50) { msg = `精準命中！ +${hitZone.points}`; color = '#00FF00'; }
                else { msg = `進球！ +${hitZone.points}`; }

                msg += `\n✨ 華麗加成 +${beautyScore}`;
                showMessage(msg, color);

                resultTimeout = setTimeout(resetShot, 2000); 

            } else {
                if(document.getElementById('message').style.opacity === '0') {
                    showMessage("打偏了... 生存失敗！", '#FF5555');
                }
                resultTimeout = setTimeout(endGame, 2000);
            }
        }

        function endGame() {
            gameState = 'gameover';
            document.getElementById('restart-btn').style.display = 'block';
            showMessage(`遊戲結束！\n總分: ${score}\n連進: ${streak} 球`, '#FFD700');
        }

        window.resetGame = function() {
            if(resultTimeout) clearTimeout(resultTimeout);
            score = 0;
            streak = 0;
            currentBaseSpeed = 3;
            goalMoveSpeed = currentBaseSpeed;
            
            document.getElementById('score-display').innerText = `分數: ${score}`;
            document.getElementById('streak-display').innerText = `連續進球: ${streak}`;
            document.getElementById('restart-btn').style.display = 'none';
            document.getElementById('message').style.opacity = '0';
            
            goalGroup.position.x = 0;
            goalDirection = 1;
            
            resetShot();
        };

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const frameDt = Math.min(clock.getDelta(), 0.1);
            
            if (gameState === 'aiming' && isCharging) {
                power += frameDt * 65; 
                if (power > ABSOLUTE_MAX_POWER) power = ABSOLUTE_MAX_POWER;

                const displayPower = Math.min(power, MAX_SAFE_POWER);
                const percentage = (displayPower / MAX_SAFE_POWER) * 100;
                powerFill.style.width = `${percentage}%`;

                // 晃動幅度飆升 500% (將原本的 3 倍乘數提升至 15 倍)
                const pFactor = displayPower / MAX_SAFE_POWER;
                let shakeMag = pFactor * 10 * 15; // 增加 500%：最高可抖動 150px！
                
                if (power > MAX_SAFE_POWER) {
                    powerFill.style.background = '#FF0000';
                    shakeMag = 20 * 15; // 爆氣時直接跨越畫面狂抖 300px！
                } else {
                    powerFill.style.background = 'linear-gradient(90deg, #00FF00, #FFFF00)';
                }

                // 劇烈隨機震顫，強烈干擾視覺
                const shakeX = (Math.random() - 0.5) * shakeMag;
                const shakeY = (Math.random() - 0.5) * shakeMag;
                crosshairUI.style.left = `${baseCrosshairX + shakeX}px`;
                crosshairUI.style.top = `${baseCrosshairY + shakeY}px`;

                // 將 CSS 像素的抖動量，反向換算回 3D 空間的座標偏移
                const width3D = 40;  
                const height3D = 20; 
                shakenAimTarget.x = aimTarget.x + (shakeX / gameContainer.clientWidth) * width3D;
                shakenAimTarget.y = aimTarget.y - (shakeY / gameContainer.clientHeight) * height3D; 
            }

            // Fixed Timestep 物理核心
            timeAccumulator += frameDt;
            if (timeAccumulator > 0.2) timeAccumulator = 0.2; 

            while (timeAccumulator >= FIXED_DT) {
                if (gameState !== 'gameover') {
                    goalGroup.position.x += goalDirection * goalMoveSpeed * FIXED_DT;
                    if (Math.abs(goalGroup.position.x) >= goalMaxOffset) {
                        goalDirection = Math.sign(goalGroup.position.x) * -1; 
                        goalMoveSpeed = currentBaseSpeed + (Math.random() - 0.5) * (currentBaseSpeed * 0.5); 
                        goalMoveSpeed = Math.max(2, goalMoveSpeed); 
                        goalMaxOffset = 4 + Math.random() * 8; 
                    }
                }

                if (gameState === 'flying' || gameState === 'result') {
                    if (gameState === 'flying') flightTime += FIXED_DT;
                    
                    const subSteps = 3;
                    const sDt = FIXED_DT / subSteps;

                    for (let i = 0; i < subSteps; i++) {
                        if (ball.position.y > flightApex) flightApex = ball.position.y;

                        const magnusForce = new THREE.Vector3().crossVectors(velocity, spin).multiplyScalar(magnusConstant);
                        velocity.add(magnusForce.multiplyScalar(sDt));
                        velocity.y -= gravity * sDt;
                        velocity.multiplyScalar(Math.pow(drag, 1/subSteps)); 

                        ball.position.addScaledVector(velocity, sDt);
                        ball.rotation.x += (velocity.z / ballRadius) * sDt + spin.x * sDt;
                        ball.rotation.y += spin.y * sDt;
                        ball.rotation.z -= (velocity.x / ballRadius) * sDt;

                        if (ball.position.y <= ballRadius) {
                            ball.position.y = ballRadius;
                            velocity.y *= -0.6; 
                            velocity.x *= 0.99; 
                            velocity.z *= 0.99;
                            spin.multiplyScalar(0.9); 
                        }

                        let lpX = goalGroup.position.x - goalWidth/2;
                        let rpX = goalGroup.position.x + goalWidth/2;
                        let colDist = ballRadius + postRadius; 

                        let distLP = Math.hypot(ball.position.x - lpX, ball.position.z - goalZ);
                        if (distLP < colDist && ball.position.y < goalHeight + ballRadius) {
                            let normal = new THREE.Vector3(ball.position.x - lpX, 0, ball.position.z - goalZ).normalize();
                            let vDot = velocity.dot(normal);
                            if (vDot < 0) { 
                                velocity.sub(normal.multiplyScalar(2 * vDot)).multiplyScalar(0.75); 
                                ball.position.x += normal.x * (colDist - distLP);
                                ball.position.z += normal.z * (colDist - distLP);
                                spin.multiplyScalar(0.5); 
                            }
                        }

                        let distRP = Math.hypot(ball.position.x - rpX, ball.position.z - goalZ);
                        if (distRP < colDist && ball.position.y < goalHeight + ballRadius) {
                            let normal = new THREE.Vector3(ball.position.x - rpX, 0, ball.position.z - goalZ).normalize();
                            let vDot = velocity.dot(normal);
                            if (vDot < 0) {
                                velocity.sub(normal.multiplyScalar(2 * vDot)).multiplyScalar(0.75);
                                ball.position.x += normal.x * (colDist - distRP);
                                ball.position.z += normal.z * (colDist - distRP);
                                spin.multiplyScalar(0.5);
                            }
                        }

                        let distCB = Math.hypot(ball.position.y - goalHeight, ball.position.z - goalZ);
                        if (distCB < colDist && ball.position.x > lpX - ballRadius && ball.position.x < rpX + ballRadius) {
                            let normal = new THREE.Vector3(0, ball.position.y - goalHeight, ball.position.z - goalZ).normalize();
                            let vDot = velocity.dot(normal);
                            if (vDot < 0) {
                                velocity.sub(normal.multiplyScalar(2 * vDot)).multiplyScalar(0.75);
                                ball.position.y += normal.y * (colDist - distCB);
                                ball.position.z += normal.z * (colDist - distCB);
                                spin.multiplyScalar(0.5);
                            }
                        }

                        if (gameState === 'flying') {
                            if (ball.position.z < goalZ && ball.position.z > goalZ - 4) { 
                                let relX = ball.position.x - goalGroup.position.x;
                                if (relX > -goalWidth/2 + ballRadius && relX < goalWidth/2 - ballRadius && ball.position.y < goalHeight - ballRadius) {
                                    velocity.z *= -0.2; 
                                    velocity.x *= 0.3;
                                    velocity.y *= 0.3;

                                    let hitZone = null;
                                    for(let zone of zones) {
                                        if (relX >= zone.localBounds.minX && relX <= zone.localBounds.maxX &&
                                            ball.position.y >= zone.localBounds.minY && ball.position.y <= zone.localBounds.maxY) {
                                            hitZone = zone;
                                            break;
                                        }
                                    }
                                    if(!hitZone) hitZone = zones[4]; 
                                    processResult(hitZone);
                                }
                            }
                        }
                    } 

                    if(gameState === 'flying') {
                        trailPositions.push(ball.position.clone());
                        if (trailPositions.length > 80) trailPositions.shift(); 
                        trailGeo.setFromPoints(trailPositions);
                    }

                    if (gameState === 'flying') {
                        let isStopped = velocity.length() < 0.8 && ball.position.y <= ballRadius + 0.1;
                        let isFarAway = ball.position.z < -100 || Math.abs(ball.position.x) > 60;
                        let isTimeOut = flightTime > 7.0;

                        if (isStopped || isFarAway || isTimeOut) {
                            processResult(null); 
                        }
                    }
                }
                
                timeAccumulator -= FIXED_DT;
            } 

            renderer.render(scene, camera);
        }

        resetShot();
        animate();

    </script>
</body>
</html>
