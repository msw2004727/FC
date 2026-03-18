/* ================================================
   SportHub — FC Scene (Profile Banner)
   像素足球角色場景，嵌入個人頁 #profile-slot-banner
   自動跟隨主站深淺主題，右上角顯示太陽/月亮
   ================================================ */
;(function(){
// ===== CONFIG =====
var W = 16, H = 30, SCALE = 11;
var OY = 5;
var SKINS = ["#FDBCB4","#E8A87C","#D4915E","#C68642","#8D5524","#5C3A1E"];
var HAIRS = ["#1A1A1A","#3B2F2F","#654321","#DAA520","#C0392B","#F5F5DC","#FF69B4","#4169E1"];
var JERSEYS = ["#E74C3C","#3498DB","#FFFFFF","#27AE60","#F39C12","#9B59B6","#1A1A1A","#FF6B6B","#E67E22","#1ABC9C"];
var SHORTS_C = ["#1A1A1A","#FFFFFF","#2C3E50","#E74C3C","#3498DB","#27AE60"];
var SHOES_C = ["#1A1A1A","#FFFFFF","#E74C3C","#F39C12","#3498DB"];
var SOCK_C = ["#FFFFFF","#1A1A1A","#E74C3C","#3498DB","#F39C12"];

var HAIR_NAMES = ["短髮","中長髮","長髮","莫西干","光頭","爆炸頭","瀏海","側分"];
var FACE_NAMES = ["標準","圓臉","方臉","尖臉"];
var EYE_NAMES = ["普通","大眼","瞇眼","圓眼","怒目"];
var MOUTH_NAMES = ["微笑","普通","張嘴","不悅","嘟嘴"];
var EYEBROW_NAMES = ["普通","粗眉","高挑","八字"];

// ===== PROCEDURAL PIXEL DRAWING =====
function drawPixel(grid, x, y, color) {
  if (x >= 0 && x < W && y >= 0 && y < H && color) grid[y][x] = color;
}
function drawRect(grid, x, y, w, h, color) {
  for (var dy = 0; dy < h; dy++)
    for (var dx = 0; dx < w; dx++)
      drawPixel(grid, x + dx, y + dy, color);
}
function emptyGrid() {
  return Array.from({length: H}, function() { return Array(W).fill(null); });
}
function darken(hex, amt) {
  var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return '#' + Math.max(0,Math.floor(r*(1-amt))).toString(16).padStart(2,'0') + Math.max(0,Math.floor(g*(1-amt))).toString(16).padStart(2,'0') + Math.max(0,Math.floor(b*(1-amt))).toString(16).padStart(2,'0');
}

// ===== DRAW CHARACTER =====
function drawCharacter(cfg, dir, anim, frameIdx) {
  var grid = emptyGrid();
  var skin = SKINS[cfg.skin];
  var hair = HAIRS[cfg.hair];
  var jersey = JERSEYS[cfg.jersey];
  var shorts = SHORTS_C[cfg.shorts];
  var shoes = SHOES_C[cfg.shoes];
  var socks = SOCK_C[cfg.socks];
  var darkSkin = darken(skin, 0.15);
  var darkJersey = darken(jersey, 0.2);
  var darkShorts = darken(shorts, 0.2);
  var colors = { skin:skin, darkSkin:darkSkin, hair:hair, jersey:jersey, darkJersey:darkJersey, shorts:shorts, darkShorts:darkShorts, shoes:shoes, socks:socks };

  var pose = getPose(dir, anim, frameIdx);
  if (dir === "front") drawFront(grid, cfg, pose, colors);
  else if (dir === "back") drawBack(grid, cfg, pose, colors);
  else drawSide(grid, cfg, pose, colors, dir);
  return grid;
}

// ===== POSE DATA =====
function getPose(dir, anim, fi) {
  var poses = {
    front: {
      idle: [{ by:0, llx:0, lly:0, rlx:0, rly:0, lax:0, rax:0 },{ by:0, llx:0, lly:0, rlx:0, rly:0, lax:0, rax:0 }],
      walk: [{ by:0,llx:-1,lly:0,rlx:1,rly:-1,lax:1,rax:-1 },{ by:-1,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 },{ by:0,llx:1,lly:-1,rlx:-1,rly:0,lax:-1,rax:1 },{ by:-1,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 }],
      run: [{ by:0,llx:-2,lly:0,rlx:2,rly:-2,lax:2,rax:-2 },{ by:-1,llx:-1,lly:0,rlx:1,rly:-1,lax:1,rax:-1 },{ by:0,llx:2,lly:-2,rlx:-2,rly:0,lax:-2,rax:2 },{ by:-1,llx:1,lly:-1,rlx:-1,rly:0,lax:-1,rax:1 }],
      jump: [{ by:0,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 },{ by:-2,llx:0,lly:0,rlx:0,rly:0,lax:1,rax:1 },{ by:-4,llx:1,lly:-1,rlx:-1,rly:-1,lax:2,rax:2 },{ by:-1,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 }],
    },
    side: {
      idle: [{ by:0,fLeg:0,bLeg:0,arm:0,lean:0 },{ by:0,fLeg:0,bLeg:0,arm:0,lean:0 }],
      walk: [{ by:0,fLeg:2,bLeg:-2,arm:-2,lean:0 },{ by:-1,fLeg:0,bLeg:0,arm:0,lean:0 },{ by:0,fLeg:-2,bLeg:2,arm:2,lean:0 },{ by:-1,fLeg:0,bLeg:0,arm:0,lean:0 }],
      run: [{ by:0,fLeg:3,bLeg:-3,arm:-3,lean:1 },{ by:-1,fLeg:1,bLeg:-1,arm:-1,lean:1 },{ by:-2,fLeg:-1,bLeg:1,arm:1,lean:1 },{ by:0,fLeg:-3,bLeg:3,arm:3,lean:1 }],
      jump: [{ by:0,fLeg:0,bLeg:0,arm:0,lean:0 },{ by:-2,fLeg:-1,bLeg:1,arm:2,lean:0 },{ by:-4,fLeg:-2,bLeg:2,arm:3,lean:0 },{ by:-1,fLeg:0,bLeg:0,arm:0,lean:0 }],
    },
    back: {
      idle: [{ by:0,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 }],
      walk: [{ by:0,llx:-1,lly:0,rlx:1,rly:-1,lax:1,rax:-1 },{ by:-1,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 },{ by:0,llx:1,lly:-1,rlx:-1,rly:0,lax:-1,rax:1 },{ by:-1,llx:0,lly:0,rlx:0,rly:0,lax:0,rax:0 }],
    },
  };
  var dirKey = (dir === "left" || dir === "right") ? "side" : dir;
  var frames = (poses[dirKey] && poses[dirKey][anim]) || (poses[dirKey] && poses[dirKey].idle) || [{}];
  return frames[fi % frames.length];
}

// ===== FRONT VIEW =====
function drawFront(grid, cfg, pose, c) {
  var by = pose.by || 0, cx = 8;
  var legBaseY = 17 + OY + by;
  var llx = cx - 4 + (pose.llx||0), lly = legBaseY + (pose.lly||0);
  drawRect(grid, llx, lly, 3, 2, c.shorts); drawRect(grid, llx, lly+2, 3, 2, c.socks); drawRect(grid, llx, lly+4, 3, 1, c.shoes);
  var rlx = cx + 1 + (pose.rlx||0), rly = legBaseY + (pose.rly||0);
  drawRect(grid, rlx, rly, 3, 2, c.darkShorts); drawRect(grid, rlx, rly+2, 3, 2, c.socks); drawRect(grid, rlx, rly+4, 3, 1, c.shoes);
  var torsoY = 10 + OY + by;
  drawRect(grid, cx-4, torsoY, 8, 7, c.jersey); drawRect(grid, cx-5, torsoY+1, 10, 4, c.jersey);
  drawRect(grid, cx-1, torsoY+2, 2, 2, "#FFFFFF");
  drawRect(grid, cx-4, torsoY+7, 8, 2, c.shorts);
  var armY = torsoY + 1;
  var lax = cx - 6 + (pose.lax||0);
  drawRect(grid, lax, armY, 2, 3, c.jersey); drawRect(grid, lax, armY+3, 2, 2, c.skin);
  var rax = cx + 4 + (pose.rax||0);
  drawRect(grid, rax, armY, 2, 3, c.darkJersey); drawRect(grid, rax, armY+3, 2, 2, c.darkSkin);
  drawRect(grid, cx - 2, torsoY - 2, 4, 3, c.skin);
  var headY = 2 + OY + by;
  drawHead(grid, cfg, cx, headY, c.skin, c.darkSkin, c.hair, "front");
}

// ===== BACK VIEW =====
function drawBack(grid, cfg, pose, c) {
  var by = pose.by || 0, cx = 8;
  var legBaseY = 17 + OY + by;
  var llx = cx - 4 + (pose.llx||0), lly = legBaseY + (pose.lly||0);
  drawRect(grid, llx, lly, 3, 2, c.darkShorts); drawRect(grid, llx, lly+2, 3, 2, c.socks); drawRect(grid, llx, lly+4, 3, 1, c.shoes);
  var rlx = cx + 1 + (pose.rlx||0), rly = legBaseY + (pose.rly||0);
  drawRect(grid, rlx, rly, 3, 2, c.darkShorts); drawRect(grid, rlx, rly+2, 3, 2, c.socks); drawRect(grid, rlx, rly+4, 3, 1, c.shoes);
  var torsoY = 10 + OY + by;
  drawRect(grid, cx-4, torsoY, 8, 7, c.darkJersey); drawRect(grid, cx-5, torsoY+1, 10, 4, c.darkJersey);
  drawRect(grid, cx-2, torsoY+1, 4, 3, "#FFFFFF");
  drawRect(grid, cx-4, torsoY+7, 8, 2, c.darkShorts);
  var armY = torsoY + 1;
  drawRect(grid, cx-6+(pose.lax||0), armY, 2, 3, c.darkJersey); drawRect(grid, cx-6+(pose.lax||0), armY+3, 2, 2, c.darkSkin);
  drawRect(grid, cx+4+(pose.rax||0), armY, 2, 3, c.darkJersey); drawRect(grid, cx+4+(pose.rax||0), armY+3, 2, 2, c.darkSkin);
  drawRect(grid, cx - 2, torsoY - 2, 4, 3, c.darkSkin);
  var headY = 2 + OY + by;
  drawHead(grid, cfg, cx, headY, c.skin, c.darkSkin, c.hair, "back");
}

// ===== SIDE VIEW =====
function drawSide(grid, cfg, pose, c, dir) {
  var by = pose.by || 0, lean = pose.lean || 0;
  var isLeft = dir === "left";
  var cx = isLeft ? 9 : 7;
  var torsoX = isLeft ? cx - 5 : cx - 1;
  var torsoY = 10 + OY + by;
  var bw = 6;
  var bLegOff = pose.bLeg || 0;
  var bLegX = isLeft ? torsoX + 1 : torsoX + 2;
  var bLegY = 17 + OY + by + Math.max(0, -bLegOff);
  drawRect(grid, bLegX, bLegY, 3, 2, c.darkShorts); drawRect(grid, bLegX, bLegY+2, 3, 2, darken(c.socks,0.15));
  if (bLegOff >= 0) drawRect(grid, bLegX, bLegY+4, 3, 1, darken(c.shoes,0.15));
  drawRect(grid, torsoX, torsoY - lean, bw, 7, c.jersey);
  var stripeX = isLeft ? torsoX + 3 : torsoX + 2;
  drawRect(grid, stripeX, torsoY + 1 - lean, 1, 4, c.darkJersey);
  drawRect(grid, torsoX, torsoY + 7 - lean, bw, 2, c.shorts);
  var fLegOff = pose.fLeg || 0;
  var fLegX = isLeft ? torsoX + 2 : torsoX + 1;
  var fLegY = 17 + OY + by + Math.max(0, -fLegOff);
  drawRect(grid, fLegX, fLegY, 3, 2, c.shorts); drawRect(grid, fLegX, fLegY+2, 3, 2, c.socks);
  if (fLegOff <= 0) drawRect(grid, fLegX, fLegY+4, 3, 1, c.shoes);
  var armOff = pose.arm || 0;
  var armX = isLeft ? torsoX + 2 + armOff : torsoX + 2 - armOff;
  var armBaseY = torsoY + 1 - lean;
  drawRect(grid, armX, armBaseY, 2, 3, c.jersey); drawRect(grid, armX, armBaseY + 3, 2, 2, c.skin);
  var neckX = isLeft ? torsoX + 1 : torsoX + 2;
  drawRect(grid, neckX, torsoY - 1 - lean, 3, 2, c.skin);
  var headY = 3 + OY + by - lean;
  drawHead(grid, cfg, cx, headY, c.skin, c.darkSkin, c.hair, dir);
}

// ===== HEAD DRAWING =====
function drawHead(grid, cfg, cx, headY, skin, darkSkin, hair, dir) {
  var face = cfg.face || 0;
  if (dir === "front") drawHeadFront(grid, cfg, cx, headY, skin, darkSkin, hair, face);
  else if (dir === "back") drawHeadBack(grid, cfg, cx, headY, skin, darkSkin, hair, face);
  else drawHeadSide(grid, cfg, cx, headY, skin, darkSkin, hair, face, dir === "left");
}

function drawHeadFront(grid, cfg, cx, headY, skin, darkSkin, hair, face) {
  var baseW = 8, hx = cx - 4;
  if (face === 0) { drawRect(grid, hx, headY, baseW, 6, skin); drawRect(grid, hx+1, headY-1, baseW-2, 1, skin); drawPixel(grid, hx-1, headY+2, skin); drawPixel(grid, hx+baseW, headY+2, skin); }
  else if (face === 1) { drawRect(grid, hx, headY, baseW, 6, skin); drawRect(grid, hx-1, headY+1, baseW+2, 4, skin); drawRect(grid, hx+1, headY-1, baseW-2, 1, skin); drawPixel(grid, hx-2, headY+2, skin); drawPixel(grid, hx+baseW+1, headY+2, skin); }
  else if (face === 2) { drawRect(grid, hx, headY, baseW, 6, skin); drawRect(grid, hx-1, headY+1, baseW+2, 4, skin); drawRect(grid, hx, headY-1, baseW, 1, skin); drawPixel(grid, hx-2, headY+2, skin); drawPixel(grid, hx+baseW+1, headY+2, skin); }
  else if (face === 3) { drawRect(grid, hx+1, headY, baseW-2, 6, skin); drawRect(grid, hx, headY+1, baseW, 3, skin); drawRect(grid, hx+2, headY+5, baseW-4, 2, skin); drawRect(grid, hx+2, headY-1, baseW-4, 1, skin); drawPixel(grid, hx-1, headY+2, skin); drawPixel(grid, hx+baseW, headY+2, skin); }
  drawHairFront(grid, cfg, cx, headY, baseW, hair, face);
  drawEyebrows(grid, cfg, cx, headY, baseW, face);
  drawEyesFront(grid, cfg, cx, headY, baseW, face);
  drawMouthFront(grid, cfg, cx, headY, face);
}

function drawHeadBack(grid, cfg, cx, headY, skin, darkSkin, hair, face) {
  var baseW = 8, hx = cx - 4;
  drawRect(grid, hx, headY, baseW, 6, darkSkin);
  if (face === 1 || face === 2) drawRect(grid, hx-1, headY+1, baseW+2, 4, darkSkin);
  if (face === 3) { drawRect(grid, hx+1, headY, baseW-2, 6, darkSkin); drawRect(grid, hx, headY+1, baseW, 3, darkSkin); }
  var hs = cfg.hairStyle || 0;
  if (hs !== 4) {
    drawRect(grid, hx, headY-1, baseW, 6, hair); drawRect(grid, hx+1, headY-2, baseW-2, 2, hair);
    drawRect(grid, hx-1, headY, 1, 4, hair); drawRect(grid, hx+baseW, headY, 1, 4, hair);
    if (hs === 1 || hs === 6 || hs === 7) drawRect(grid, hx-1, headY+4, baseW+2, 2, hair);
    if (hs === 2) { drawRect(grid, hx-1, headY+4, baseW+2, 4, hair); drawRect(grid, hx-2, headY+3, 1, 4, hair); drawRect(grid, hx+baseW+1, headY+3, 1, 4, hair); }
    if (hs === 5) { drawRect(grid, hx-2, headY-3, baseW+4, 4, hair); drawRect(grid, hx-3, headY-2, baseW+6, 4, hair); drawRect(grid, hx-2, headY+1, 2, 3, hair); drawRect(grid, hx+baseW, headY+1, 2, 3, hair); }
    if (hs === 3) { drawRect(grid, cx-1, headY-3, 2, 3, hair); drawRect(grid, cx-2, headY-2, 4, 1, hair); }
  }
  drawPixel(grid, hx-1, headY+2, darkSkin); drawPixel(grid, hx+baseW, headY+2, darkSkin);
}

function drawHeadSide(grid, cfg, cx, headY, skin, darkSkin, hair, face, isLeft) {
  var hw = 6, hx = isLeft ? cx - 4 : cx - 2;
  var faceH = face === 3 ? 7 : 6;
  drawRect(grid, hx, headY, hw, faceH, skin);
  var topX = isLeft ? hx - 1 : hx;
  drawRect(grid, topX, headY-1, hw, 1, skin);
  var b1 = isLeft ? hx - 1 : hx + hw;
  drawRect(grid, b1, headY, 1, faceH - 1, skin);
  if (face === 1) { drawPixel(grid, isLeft ? hx+hw : hx-1, headY+2, skin); drawPixel(grid, isLeft ? hx+hw : hx-1, headY+3, skin); }
  if (face === 3) drawRect(grid, isLeft ? hx+2 : hx+1, headY+faceH, 2, 1, skin);
  drawPixel(grid, isLeft ? hx : hx+hw-1, headY+2, darkSkin);
  var noseX = isLeft ? hx+hw : hx-1;
  drawPixel(grid, noseX, headY+3, skin);
  drawHairSide(grid, cfg, hx, headY, hw, faceH, hair, isLeft);
  var eyeX = isLeft ? hx + hw - 2 : hx + 1, eyeY = headY + 2;
  var eye = cfg.eye || 0;
  if (eye === 2) { drawPixel(grid, eyeX, eyeY, "#1A1A1A"); }
  else if (eye === 1) { drawPixel(grid, eyeX, eyeY-1, "#FFFFFF"); drawPixel(grid, eyeX, eyeY, "#1A1A1A"); drawPixel(grid, isLeft?eyeX+1:eyeX-1, eyeY, "#FFFFFF"); }
  else { drawPixel(grid, eyeX, eyeY-1, "#FFFFFF"); drawPixel(grid, eyeX, eyeY, "#1A1A1A"); }
  drawPixel(grid, eyeX, headY + 1, cfg.eyebrow === 1 ? darken(hair,0.3) : "#3B2F2F");
  var mouthX = isLeft ? hx + hw - 1 : hx;
  drawPixel(grid, mouthX, headY + faceH - 2, "#C0392B");
}

// ===== HAIR =====
function drawHairFront(grid, cfg, cx, headY, baseW, hair, face) {
  var hs = cfg.hairStyle || 0, hx = cx - 4;
  if (hs === 4) return;
  drawRect(grid, hx, headY-1, baseW, 2, hair); drawRect(grid, hx+1, headY-2, baseW-2, 1, hair);
  if (hs === 0) { drawRect(grid, hx-1, headY, 1, 2, hair); drawRect(grid, hx+baseW, headY, 1, 2, hair); }
  else if (hs === 1) { drawRect(grid, hx-1, headY, 1, 4, hair); drawRect(grid, hx+baseW, headY, 1, 4, hair); }
  else if (hs === 2) { drawRect(grid, hx-1, headY, 1, 7, hair); drawRect(grid, hx+baseW, headY, 1, 7, hair); drawRect(grid, hx-2, headY+2, 1, 5, hair); drawRect(grid, hx+baseW+1, headY+2, 1, 5, hair); }
  else if (hs === 3) { drawRect(grid, cx-1, headY-4, 2, 4, hair); drawRect(grid, cx-2, headY-3, 4, 1, hair); }
  else if (hs === 5) { drawRect(grid, hx-2, headY-3, baseW+4, 4, hair); drawRect(grid, hx-3, headY-2, baseW+6, 3, hair); drawRect(grid, hx-2, headY, 2, 3, hair); drawRect(grid, hx+baseW, headY, 2, 3, hair); }
  else if (hs === 6) { drawRect(grid, hx, headY, baseW, 2, hair); drawRect(grid, hx-1, headY, 1, 3, hair); drawRect(grid, hx+baseW, headY, 1, 3, hair); drawRect(grid, hx, headY+1, Math.floor(baseW/2)+1, 1, hair); }
  else if (hs === 7) { drawRect(grid, hx-1, headY, 1, 3, hair); drawRect(grid, hx+baseW, headY, 1, 4, hair); drawRect(grid, hx+baseW+1, headY+1, 1, 3, hair); drawPixel(grid, hx+2, headY, darken(hair, 0.3)); }
}

function drawHairSide(grid, cfg, hx, headY, hw, faceH, hair, isLeft) {
  var hs = cfg.hairStyle || 0;
  if (hs === 4) return;
  var topStart = isLeft ? hx - 1 : hx, topW = hw + 1;
  drawRect(grid, topStart, headY-2, topW, 2, hair);
  var b1 = isLeft ? hx - 1 : hx + hw;
  drawRect(grid, b1, headY-1, 1, faceH, hair);
  var backX2 = isLeft ? hx : hx + hw - 1;
  drawRect(grid, backX2, headY-1, 1, faceH, hair);
  if (hs === 1 || hs === 6) { drawRect(grid, b1, headY+faceH-1, 1, 2, hair); if (hs === 6) { var bangX = isLeft ? hx+hw-2 : hx+1; drawRect(grid, bangX, headY, 2, 2, hair); } }
  else if (hs === 2) { drawRect(grid, b1, headY+faceH-1, 1, 4, hair); drawRect(grid, isLeft?b1-1:b1+1, headY+faceH, 1, 3, hair); }
  else if (hs === 3) { drawRect(grid, hx+1, headY-4, hw-2, 3, hair); }
  else if (hs === 5) { drawRect(grid, hx-2, headY-3, hw+4, 3, hair); drawRect(grid, hx-3, headY-2, hw+6, 3, hair); drawRect(grid, isLeft?hx-3:hx+hw, headY, 3, 3, hair); }
  else if (hs === 7) { drawRect(grid, b1, headY+faceH-1, 1, 3, hair); var partX = isLeft ? hx+hw-2 : hx+1; drawRect(grid, partX, headY-1, 1, 1, darken(hair, 0.3)); }
}

// ===== FACE FEATURES =====
function drawEyebrows(grid, cfg, cx, headY) {
  var eb = cfg.eyebrow || 0, y = headY + 1, bc = "#3B2F2F";
  var lx = cx - 3, rx = cx + 1;
  if (eb === 0) { drawRect(grid, lx, y, 2, 1, bc); drawRect(grid, rx, y, 2, 1, bc); }
  else if (eb === 1) { drawRect(grid, lx-1, y, 3, 1, bc); drawRect(grid, rx, y, 3, 1, bc); }
  else if (eb === 2) { drawRect(grid, lx, y-1, 2, 1, bc); drawRect(grid, rx, y-1, 2, 1, bc); }
  else if (eb === 3) { drawPixel(grid, lx, y, bc); drawPixel(grid, lx+1, y+1, bc); drawPixel(grid, rx+1, y, bc); drawPixel(grid, rx, y+1, bc); }
}

function drawEyesFront(grid, cfg, cx, headY) {
  var eye = cfg.eye || 0, y = headY + 2;
  var lx = cx - 3, rx = cx + 1;
  if (eye === 0) { drawPixel(grid, lx, y, "#FFFFFF"); drawPixel(grid, lx+1, y, "#1A1A1A"); drawPixel(grid, rx, y, "#1A1A1A"); drawPixel(grid, rx+1, y, "#FFFFFF"); }
  else if (eye === 1) { drawRect(grid, lx, y, 2, 2, "#FFFFFF"); drawPixel(grid, lx+1, y+1, "#1A1A1A"); drawRect(grid, rx, y, 2, 2, "#FFFFFF"); drawPixel(grid, rx, y+1, "#1A1A1A"); }
  else if (eye === 2) { drawRect(grid, lx, y+1, 2, 1, "#1A1A1A"); drawRect(grid, rx, y+1, 2, 1, "#1A1A1A"); }
  else if (eye === 3) { drawPixel(grid, lx, y, "#FFFFFF"); drawPixel(grid, lx+1, y, "#FFFFFF"); drawPixel(grid, lx, y+1, "#FFFFFF"); drawPixel(grid, lx+1, y+1, "#1A1A1A"); drawPixel(grid, rx, y, "#FFFFFF"); drawPixel(grid, rx+1, y, "#FFFFFF"); drawPixel(grid, rx, y+1, "#1A1A1A"); drawPixel(grid, rx+1, y+1, "#FFFFFF"); }
  else if (eye === 4) { drawPixel(grid, lx, y, "#FFFFFF"); drawPixel(grid, lx+1, y, "#1A1A1A"); drawPixel(grid, rx, y, "#1A1A1A"); drawPixel(grid, rx+1, y, "#FFFFFF"); drawPixel(grid, lx+1, y-1, "#3B2F2F"); drawPixel(grid, rx, y-1, "#3B2F2F"); }
}

function drawMouthFront(grid, cfg, cx, headY, face) {
  var m = cfg.mouth || 0, y = headY + (face === 3 ? 5 : 4);
  if (m === 0) { drawPixel(grid, cx-1, y, "#C0392B"); drawPixel(grid, cx, y, "#C0392B"); drawPixel(grid, cx-2, y-1, "#C0392B"); drawPixel(grid, cx+1, y-1, "#C0392B"); }
  else if (m === 1) { drawRect(grid, cx-1, y, 2, 1, "#C0392B"); }
  else if (m === 2) { drawRect(grid, cx-1, y-1, 2, 2, "#8B0000"); drawRect(grid, cx-1, y-1, 2, 1, "#C0392B"); }
  else if (m === 3) { drawPixel(grid, cx-1, y-1, "#C0392B"); drawPixel(grid, cx, y-1, "#C0392B"); drawPixel(grid, cx-2, y, "#C0392B"); drawPixel(grid, cx+1, y, "#C0392B"); }
  else if (m === 4) { drawRect(grid, cx-1, y, 2, 1, "#E74C3C"); drawPixel(grid, cx-1, y-1, "#E74C3C"); drawPixel(grid, cx, y-1, "#E74C3C"); }
}

// ===== SCENE CONFIG =====
var SCENE_H = 127;
var PX = 3;
var MAX_ACTORS = 8;
var GREET_BUBBLES = ["👋","⚽","🤝","✌️"];
var HAPPY_BUBBLES = ["🎉","⭐","💪","🔥","👏"];
var ANGRY_BUBBLES = ["😤","💢","👊","⚡"];
var QUESTION_BUBBLES = ["❓","🤔","👀"];

// ===== BALL =====
function createBall(sw) { return { x: sw/2, y: 0, vx:0, vy:0, onGround:true, lastKicker:null }; }
function updateBall(ball, sw) {
  var gl = sw ? (SCENE_H - 20 - 6) : (SCENE_H - 26);
  ball.x+=ball.vx; ball.y+=ball.vy;
  if (!ball.onGround) ball.vy+=0.3;
  if (ball.y>=gl) { ball.y=gl; ball.vy=ball.vy>2?-ball.vy*0.4:0; ball.onGround=ball.vy===0; }
  else ball.onGround=false;
  ball.vx*=0.985;
  if (Math.abs(ball.vx)<0.05) ball.vx=0;
  if (ball.x<6){ball.x=6;ball.vx=Math.abs(ball.vx)*0.7;}
  if (ball.x>sw-6){ball.x=sw-6;ball.vx=-Math.abs(ball.vx)*0.7;}
}
function drawBallOnCanvas(ctx, ball, groundY) {
  var bx=Math.round(ball.x), by=Math.round(ball.y);
  ctx.fillStyle="rgba(0,0,0,0.12)";
  ctx.beginPath(); ctx.ellipse(bx,groundY-1,5,2,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#fff";
  ctx.beginPath(); ctx.arc(bx,by,5,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle="#aaa"; ctx.lineWidth=0.5; ctx.stroke();
  ctx.fillStyle="#333";
  ctx.beginPath(); ctx.arc(bx-1,by-1,2,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(bx+2,by+1,1.5,0,Math.PI*2); ctx.fill();
}
function kickBall(ball,actor,power,up) {
  var d=actor.dir==="right"?1:-1;
  ball.vx=d*power*(0.8+Math.random()*0.4);
  ball.vy=up?-(2+Math.random()*2):-(0.5+Math.random());
  ball.onGround=false; ball.lastKicker=actor.id;
}
function distToBall(a,ball) { return Math.abs(a.x+W*PX/2-ball.x); }

// ===== ACTOR =====
function randomCfg() {
  return {
    skin:Math.floor(Math.random()*SKINS.length), hair:Math.floor(Math.random()*HAIRS.length),
    hairStyle:Math.floor(Math.random()*HAIR_NAMES.length), face:Math.floor(Math.random()*FACE_NAMES.length),
    eye:Math.floor(Math.random()*EYE_NAMES.length), eyebrow:Math.floor(Math.random()*EYEBROW_NAMES.length),
    mouth:Math.floor(Math.random()*MOUTH_NAMES.length), jersey:Math.floor(Math.random()*JERSEYS.length),
    shorts:Math.floor(Math.random()*SHORTS_C.length), shoes:Math.floor(Math.random()*SHOES_C.length),
    socks:Math.floor(Math.random()*SOCK_C.length),
  };
}
var nextId=0;
function createActor(startX) {
  return { id:nextId++, cfg:randomCfg(), x:startX, dir:Math.random()>0.5?"right":"left", anim:"idle", frame:0, actionTimer:0, targetX:startX, speed:0, mode:"solo", interactWith:null, bubble:null, interactCooldown:0, _chatPhase:0, _arguePhase:0 };
}

// ===== SOLO AI =====
function pickSoloAction(a, ball, sw) {
  if (ball && Math.random()<0.30 && Math.abs(ball.vx)<1) {
    a.mode="chaseBall"; a.anim="run"; a.speed=1.5+Math.random()*0.5;
    a.frame=0; a.actionTimer=60; a.targetX=ball.x;
    a.dir=ball.x>a.x+W*PX/2?"right":"left"; return;
  }
  var acts=["idle","idle","walk","walk","run","jump"];
  var act=acts[Math.floor(Math.random()*acts.length)];
  a.anim=act; a.frame=0; a.mode="solo"; a.interactWith=null;
  if(act==="idle"){a.speed=0;a.actionTimer=30+Math.floor(Math.random()*40);}
  else if(act==="walk"){a.speed=0.8;a.actionTimer=40+Math.floor(Math.random()*60);a.targetX=30+Math.floor(Math.random()*(sw-80));a.dir=a.targetX>a.x?"right":"left";}
  else if(act==="run"){a.speed=1.8;a.actionTimer=25+Math.floor(Math.random()*40);a.targetX=30+Math.floor(Math.random()*(sw-80));a.dir=a.targetX>a.x?"right":"left";}
  else{a.speed=0;a.actionTimer=16;}
}

// ===== INTERACTIONS =====
function findNearest(a,all){var b=null,bd=Infinity;all.forEach(function(o){if(o.id===a.id)return;var d=Math.abs(o.x-a.x);if(d<bd){b=o;bd=d;}});return{actor:b,dist:bd};}
function findNearbyGroup(a,all,r){return all.filter(function(o){return o.id!==a.id&&Math.abs(o.x-a.x)<r&&o.mode==="solo";});}
function rndFrom(arr){return arr[Math.floor(Math.random()*arr.length)];}

function tryInteraction(actor,all){
  if(actor.interactCooldown>0||all.length<2)return false;
  if(Math.random()>0.22)return false;
  var res=findNearest(actor,all);
  var other=res.actor,dist=res.dist;
  if(!other||other.mode!=="solo")return false;
  var nearby=findNearbyGroup(actor,all,120);
  if(nearby.length>=2&&Math.random()<0.2){startHuddle(actor,nearby.slice(0,3));return true;}
  var r=Math.random();
  if(dist<80){
    if(r<0.13){startGreeting(actor,other);return true;}
    if(r<0.24){startCelebrating(actor,other);return true;}
    if(r<0.35){startHighFive(actor,other);return true;}
    if(r<0.46){startChat(actor,other);return true;}
    if(r<0.55){startArgue(actor,other);return true;}
    if(r<0.64){startShowOff(actor,other);return true;}
    if(r<0.72){startComfort(actor,other);return true;}
  }
  if(r<0.50){startChase(actor,other);return true;}
  if(r<0.65){startRace(actor,other);return true;}
  if(r<0.80){startApproach(actor,other);return true;}
  return false;
}

function faceEach(a,b){a.dir=b.x>a.x?"right":"left";b.dir=a.x>b.x?"right":"left";}
function startGreeting(a,b){a.mode="greeting";a.interactWith=b.id;a.anim="idle";a.speed=0;a.frame=0;a.actionTimer=45;a.bubble={emoji:rndFrom(GREET_BUBBLES),timer:38};b.mode="greeting";b.interactWith=a.id;b.anim="idle";b.speed=0;b.frame=0;b.actionTimer=45;b.bubble={emoji:rndFrom(GREET_BUBBLES),timer:32};faceEach(a,b);}
function startCelebrating(a,b){a.mode="celebrating";a.interactWith=b.id;a.anim="jump";a.speed=0;a.frame=0;a.actionTimer=28;a.bubble={emoji:rndFrom(HAPPY_BUBBLES),timer:26};b.mode="celebrating";b.interactWith=a.id;b.anim="jump";b.speed=0;b.frame=0;b.actionTimer=28;b.bubble={emoji:rndFrom(HAPPY_BUBBLES),timer:26};faceEach(a,b);}
function startChase(c,r){c.mode="chasing";c.interactWith=r.id;c.anim="run";c.speed=1.6;c.frame=0;c.actionTimer=80;c.bubble={emoji:rndFrom(ANGRY_BUBBLES),timer:25};r.mode="fleeing";r.interactWith=c.id;r.anim="run";r.speed=2.0;r.frame=0;r.actionTimer=80;r.bubble={emoji:"😱",timer:25};}
function startHighFive(a,b){var m=(a.x+b.x)/2;a.mode="highfive";a.interactWith=b.id;a.anim="walk";a.speed=1.0;a.frame=0;a.actionTimer=60;a.targetX=m-10;a.dir=m>a.x?"right":"left";b.mode="highfive";b.interactWith=a.id;b.anim="walk";b.speed=1.0;b.frame=0;b.actionTimer=60;b.targetX=m+10;b.dir=m>b.x?"right":"left";}
function startChat(a,b){a.mode="chatting";a.interactWith=b.id;a.anim="idle";a.speed=0;a.frame=0;a.actionTimer=80;a.bubble={emoji:rndFrom(["💬","😄","🤣","😏"]),timer:25};a._chatPhase=0;b.mode="chatting";b.interactWith=a.id;b.anim="idle";b.speed=0;b.frame=0;b.actionTimer=80;b._chatPhase=0;faceEach(a,b);}
function startArgue(a,b){a.mode="arguing";a.interactWith=b.id;a.anim="idle";a.speed=0;a.frame=0;a.actionTimer=65;a.bubble={emoji:"😠",timer:20};a._arguePhase=0;b.mode="arguing";b.interactWith=a.id;b.anim="idle";b.speed=0;b.frame=0;b.actionTimer=65;b.bubble={emoji:"😡",timer:22};b._arguePhase=0;faceEach(a,b);}
function startShowOff(a,b){a.mode="showoff";a.interactWith=b.id;a.anim="jump";a.speed=0;a.frame=0;a.actionTimer=50;a.bubble={emoji:rndFrom(["💪","🏆","😎"]),timer:30};b.mode="watching";b.interactWith=a.id;b.anim="idle";b.speed=0;b.frame=0;b.actionTimer=50;faceEach(a,b);}
function startComfort(a,b){b.mode="sad";b.interactWith=a.id;b.anim="idle";b.speed=0;b.frame=0;b.actionTimer=60;b.bubble={emoji:rndFrom(["😢","😞","😔"]),timer:30};a.mode="comforting";a.interactWith=b.id;a.anim="walk";a.speed=0.8;a.frame=0;a.actionTimer=60;a.targetX=b.x+(a.x>b.x?20:-20);a.dir=b.x>a.x?"right":"left";}
function startRace(a,b,sw){var t=Math.random()>0.5?(sw||500)-80:30;a.mode="racing";a.interactWith=b.id;a.anim="run";a.speed=1.5+Math.random()*0.5;a.frame=0;a.actionTimer=70;a.targetX=t;a.dir=t>a.x?"right":"left";a.bubble={emoji:"🏁",timer:20};b.mode="racing";b.interactWith=a.id;b.anim="run";b.speed=1.5+Math.random()*0.5;b.frame=0;b.actionTimer=70;b.targetX=t;b.dir=t>b.x?"right":"left";b.bubble={emoji:"🏁",timer:20};}
function startApproach(a,b){a.mode="approaching";a.interactWith=b.id;a.anim="walk";a.speed=0.8;a.frame=0;a.actionTimer=60;a.targetX=b.x+(a.x>b.x?30:-30);a.dir=b.x>a.x?"right":"left";a.bubble={emoji:rndFrom(QUESTION_BUBBLES),timer:20};}
function startHuddle(l,others){var cx=l.x;l.mode="huddle";l.anim="idle";l.speed=0;l.frame=0;l.actionTimer=55;l.bubble={emoji:"📣",timer:25};others.forEach(function(o,i){o.mode="huddle";o.interactWith=l.id;o.anim="walk";o.speed=1.0;o.frame=0;o.actionTimer=55;o.targetX=cx+(i%2===0?25+i*10:-25-i*10);o.dir=o.targetX>o.x?"right":"left";});}

// ===== UPDATE =====
function updateActors(actors, ball, sw) {
  if(ball) updateBall(ball, sw);
  var groundY = SCENE_H - 20;
  actors.forEach(function(a){
    a.frame++; a.actionTimer--;
    if(a.interactCooldown>0) a.interactCooldown--;
    if(a.bubble){a.bubble.timer--;if(a.bubble.timer<=0)a.bubble=null;}
    var tgt=a.interactWith!=null?actors.find(function(o){return o.id===a.interactWith;}):null;
    if(a.mode==="chaseBall"&&ball){a.targetX=ball.x;a.dir=ball.x>a.x+W*PX/2?"right":"left";if(distToBall(a,ball)<18){a.anim="jump";a.speed=0;a.actionTimer=12;a.bubble={emoji:rndFrom(["⚽","🦶","💥"]),timer:15};var others=actors.filter(function(o){return o.id!==a.id;});var pt=others.length>0?others[Math.floor(Math.random()*others.length)]:null;if(pt&&Math.random()<0.5){var pd=pt.x>ball.x?1:-1;ball.vx=pd*(3+Math.random()*2);ball.vy=-(1+Math.random());ball.onGround=false;ball.lastKicker=a.id;a.bubble={emoji:"📤",timer:15};}else{kickBall(ball,a,3+Math.random()*3,Math.random()<0.4);}a.mode="solo";a.interactCooldown=25;}}
    if(a.mode==="dribbling"&&ball){if(distToBall(a,ball)>30){a.mode="solo";a.actionTimer=0;}else{if(a.frame%12===0){ball.vx=(a.dir==="right"?1:-1)*1.2;ball.vy=-0.3;ball.lastKicker=a.id;}a.targetX=ball.x+(a.dir==="right"?-15:15);}}
    if(a.mode==="chasing"){if(tgt){a.targetX=tgt.x;a.dir=tgt.x>a.x?"right":"left";if(Math.abs(a.x-tgt.x)<20){a.anim="jump";a.speed=0;a.actionTimer=8;a.bubble={emoji:"😤",timer:15};tgt.bubble={emoji:"😅",timer:15};tgt.mode="solo";tgt.interactCooldown=30;a.mode="solo";a.interactCooldown=30;}}else a.actionTimer=0;}
    if(a.mode==="fleeing"){if(tgt){var aw=a.x+(a.x>tgt.x?150:-150);a.targetX=Math.max(30,Math.min(sw-80,aw));a.dir=a.targetX>a.x?"right":"left";}else a.actionTimer=0;}
    if(a.mode==="highfive"&&tgt&&Math.abs(a.x-tgt.x)<25&&a.anim==="walk"){a.anim="jump";a.speed=0;a.actionTimer=15;a.dir=tgt.x>a.x?"right":"left";a.bubble={emoji:"🙌",timer:18};}
    if(a.mode==="chatting"){var p=Math.floor(a.frame/20);if(p!==a._chatPhase&&p%2===0){a._chatPhase=p;a.bubble={emoji:rndFrom(["😄","🤣","😏","🤔","😮","👍"]),timer:18};}if(tgt&&p!==tgt._chatPhase&&p%2===1){tgt._chatPhase=p;tgt.bubble={emoji:rndFrom(["😂","😊","🙄","💬","👌","😜"]),timer:18};}}
    if(a.mode==="arguing"){var ap=Math.floor(a.frame/18);if(ap>=3&&a._arguePhase<3){a._arguePhase=3;a.anim="run";a.speed=1.5;a.targetX=a.x+(a.dir==="right"?-200:200);a.targetX=Math.max(30,Math.min(sw-80,a.targetX));a.dir=a.targetX>a.x?"right":"left";a.bubble={emoji:"💢",timer:15};}else if(ap===1&&a._arguePhase<1){a._arguePhase=1;a.bubble={emoji:rndFrom(["🗯️","😤","👊"]),timer:16};}}
    if(a.mode==="watching"&&tgt&&a.frame===25)a.bubble={emoji:rndFrom(["👏","😲","🙄","😒"]),timer:20};
    if(a.mode==="comforting"&&tgt&&Math.abs(a.x-tgt.x)<30&&a.anim==="walk"){a.anim="idle";a.speed=0;a.dir=tgt.x>a.x?"right":"left";a.bubble={emoji:rndFrom(["❤️","🤗","💕"]),timer:25};tgt.bubble={emoji:rndFrom(["🥺","😊","🙏"]),timer:22};}
    if(a.mode==="racing"&&tgt&&Math.abs(a.x-a.targetX)<5&&a.anim==="run"){a.anim="jump";a.speed=0;a.actionTimer=15;a.bubble={emoji:rndFrom(["🥇","🎉","🏆"]),timer:20};if(tgt.mode==="racing")tgt.bubble={emoji:rndFrom(["😤","💦","🥈"]),timer:18};}
    if(a.mode==="approaching"&&tgt&&Math.abs(a.x-tgt.x)<40&&tgt.mode==="solo"){var rr=Math.random();if(rr<0.3)startChat(a,tgt);else if(rr<0.5)startGreeting(a,tgt);else if(rr<0.7)startHighFive(a,tgt);else startCelebrating(a,tgt);return;}
    if(a.mode==="huddle"){if(a.anim==="walk"&&a.actionTimer<30){a.anim="idle";a.speed=0;if(a.interactWith!=null){var ld=actors.find(function(o){return o.id===a.interactWith;});if(ld)a.dir=ld.x>a.x?"right":"left";}}if(a.actionTimer===10){a.anim="jump";a.bubble={emoji:rndFrom(["🔥","💪","⚽","🎉"]),timer:12};}}
    if(ball&&a.mode==="solo"&&a.anim==="idle"&&distToBall(a,ball)<25&&Math.abs(ball.vx)<0.5){a.mode="dribbling";a.anim="walk";a.speed=0.9;a.frame=0;a.actionTimer=60;a.dir=Math.random()>0.5?"right":"left";a.bubble={emoji:"⚽",timer:12};}
    if(a.speed>0){a.dir=a.targetX>a.x?"right":"left";var dx=a.dir==="right"?a.speed:-a.speed;var prev=a.x;a.x+=dx;a.x=Math.max(10,Math.min(sw-W*PX-10,a.x));if(Math.abs(a.x-prev)<0.01)a.actionTimer=Math.min(a.actionTimer,5);if(a.mode==="solo"&&Math.abs(a.x-a.targetX)<3)a.actionTimer=0;}
    if(a.actionTimer<=0){if(a.mode!=="solo")a.interactCooldown=35;if(!tryInteraction(a,actors))pickSoloAction(a,ball,sw);}
  });
}

// ===== HELPERS =====
function getAnimFrameIdx(a){return Math.floor(a.frame/({idle:12,walk:5,run:3,jump:4}[a.anim]||6));}
function getJumpOffset(a){if(a.anim!=="jump")return 0;return[0,-2,-4,-1][getAnimFrameIdx(a)%4]*PX*0.5;}
function drawCharToCanvas(ctx,grid,x,y){grid.forEach(function(row,gy){row.forEach(function(color,gx){if(color){ctx.fillStyle=color;ctx.fillRect(x+gx*PX,y+gy*PX,PX,PX);}});});}

function drawBubble(ctx,x,y,emoji,light){
  var bx=x,by=y-8,bw=22,bh=18,r=5,lx=bx-11,ly=by-11;
  ctx.fillStyle=light?"rgba(255,255,255,0.92)":"rgba(40,40,60,0.92)";
  ctx.beginPath();ctx.moveTo(lx+r,ly);ctx.lineTo(lx+bw-r,ly);ctx.quadraticCurveTo(lx+bw,ly,lx+bw,ly+r);ctx.lineTo(lx+bw,ly+bh-r);ctx.quadraticCurveTo(lx+bw,ly+bh,lx+bw-r,ly+bh);ctx.lineTo(lx+r,ly+bh);ctx.quadraticCurveTo(lx,ly+bh,lx,ly+bh-r);ctx.lineTo(lx,ly+r);ctx.quadraticCurveTo(lx,ly,lx+r,ly);ctx.closePath();ctx.fill();
  ctx.strokeStyle=light?"rgba(0,0,0,0.12)":"rgba(255,255,255,0.12)";ctx.lineWidth=1;ctx.stroke();
  ctx.beginPath();ctx.moveTo(bx-3,by+7);ctx.lineTo(bx,by+13);ctx.lineTo(bx+3,by+7);ctx.fillStyle=light?"rgba(255,255,255,0.92)":"rgba(40,40,60,0.92)";ctx.fill();
  ctx.font="11px serif";ctx.textAlign="center";ctx.fillText(emoji,bx,by+2);
}

// ===== SUN / MOON ICONS (top-right corner) =====
function drawSunIcon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#FDB813';
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI*2); ctx.fill();
  // Rays
  ctx.strokeStyle = '#FDB813'; ctx.lineWidth = 1.5;
  for (var i = 0; i < 8; i++) {
    var angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
    ctx.lineTo(x + Math.cos(angle) * 13, y + Math.sin(angle) * 13);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoonIcon(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = '#F5E6B8';
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
  // Crescent cutout
  ctx.fillStyle = '#0a1628';
  ctx.beginPath(); ctx.arc(x + 4, y - 2, 7, 0, Math.PI*2); ctx.fill();
  // Stars
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '6px serif';
  ctx.fillText('✦', x - 14, y - 4);
  ctx.fillText('✦', x - 8, y + 10);
  ctx.restore();
}

// ===== THEME DETECTION =====
function isThemeDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ===== MAIN INIT =====
var _sceneInterval = null;

function initProfileScene(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Clean up previous instance
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  container.innerHTML = '';

  // Canvas — responsive width, fixed height
  var canvas = document.createElement('canvas');
  var dpr = window.devicePixelRatio || 1;
  var cw = container.offsetWidth || 300;
  canvas.width = cw * dpr;
  canvas.height = SCENE_H * dpr;
  canvas.style.cssText = 'width:100%;height:' + SCENE_H + 'px;border-radius:var(--radius-sm);image-rendering:pixelated;display:block;';
  container.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var sw = cw; // scene width in CSS pixels
  var groundY = SCENE_H - 20;

  // Actors & ball
  var actors = [createActor(sw * 0.25), createActor(sw * 0.65)];
  var ball = createBall(sw);
  ball.y = groundY - 6;
  actors.forEach(function(a) { pickSoloAction(a, ball, sw); });

  function render() {
    var light = !isThemeDark();
    updateActors(actors, ball, sw);

    // Sky gradient
    var grad = ctx.createLinearGradient(0, 0, 0, SCENE_H);
    if (light) {
      grad.addColorStop(0, '#87CEEB'); grad.addColorStop(0.7, '#B0E0F0'); grad.addColorStop(1, '#4CAF50');
    } else {
      grad.addColorStop(0, '#0a1628'); grad.addColorStop(0.7, '#0f2035'); grad.addColorStop(1, '#1a3a1a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sw, SCENE_H);

    // Ground
    ctx.fillStyle = light ? '#4CAF50' : '#1a3a1a';
    ctx.fillRect(0, groundY, sw, SCENE_H - groundY);
    ctx.fillStyle = light ? '#388E3C' : '#153015';
    for (var gx = 0; gx < sw; gx += 6) ctx.fillRect(gx, groundY, 3, 2);
    ctx.fillStyle = light ? '#66BB6A' : '#1e4a1e';
    for (var gx2 = 3; gx2 < sw; gx2 += 10) ctx.fillRect(gx2, groundY, 2, 1);

    // Field line
    ctx.fillStyle = light ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, groundY + 4, sw, 1);
    var ccx = sw / 2;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(ccx, groundY - 5, 1, 10);

    // Sun / Moon icon (top-right)
    if (light) {
      drawSunIcon(ctx, sw - 20, 18);
    } else {
      drawMoonIcon(ctx, sw - 20, 18);
    }

    // Ball
    drawBallOnCanvas(ctx, ball, groundY);

    // Character shadows
    actors.forEach(function(a) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.ellipse(a.x + W*PX/2, groundY - 1, W*PX*0.35, 3, 0, 0, Math.PI*2);
      ctx.fill();
    });

    // Characters
    actors.forEach(function(actor) {
      var fi = getAnimFrameIdx(actor);
      var flipDir = actor.dir === 'left' ? 'right' : 'left';
      var sideDir = actor.anim === 'jump' ? 'front' : flipDir;
      var grid = drawCharacter(actor.cfg, sideDir, actor.anim, fi);
      var charY = groundY - H*PX + OY*PX + getJumpOffset(actor);
      drawCharToCanvas(ctx, grid, Math.round(actor.x), Math.round(charY));
      if (actor.bubble) drawBubble(ctx, actor.x + W*PX/2, charY - 2, actor.bubble.emoji, light);
    });
  }

  // Handle resize
  function handleResize() {
    cw = container.offsetWidth || 300;
    sw = cw;
    canvas.width = cw * dpr;
    canvas.height = SCENE_H * dpr;
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    // Clamp actors to new width
    actors.forEach(function(a) { a.x = Math.min(a.x, sw - W*PX - 10); });
    if (ball) ball.x = Math.min(ball.x, sw - 10);
  }

  var _resizeTimer = null;
  window.addEventListener('resize', function() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(handleResize, 150);
  });

  // 20fps game loop
  _sceneInterval = setInterval(render, 50);
}

function destroyProfileScene() {
  if (_sceneInterval) { clearInterval(_sceneInterval); _sceneInterval = null; }
  var el = document.getElementById('profile-slot-banner');
  if (el) el.innerHTML = '';
}

// ===== App Module =====
if (typeof App !== 'undefined') {
  Object.assign(App, {
    _initProfileScene: function() { initProfileScene('profile-slot-banner'); },
    _destroyProfileScene: function() { destroyProfileScene(); },
  });
}

// Global fallback
window.FCScene = { init: initProfileScene, destroy: destroyProfileScene };
})();
