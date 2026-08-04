import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import GUI from 'lil-gui';

// ========== earcut 三角剖分库（内联完整版）==========
function earcut(data, holeIndices, dim) {
    dim = dim || 2;
    var hasHoles = holeIndices && holeIndices.length,
        outerLen = hasHoles ? holeIndices[0] * dim : data.length,
        outerNode = linkedList(data, 0, outerLen, dim, true),
        triangles = [];
    if (!outerNode || outerNode.next === outerNode.prev) return triangles;
    var minX, minY, maxX, maxY, x, y, invSize;
    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);
    if (data.length > 80 * dim) {
        minX = maxX = data[0];
        minY = maxY = data[1];
        for (var i = dim; i < outerLen; i += dim) {
            x = data[i]; y = data[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        invSize = Math.max(maxX - minX, maxY - minY);
        invSize = invSize !== 0 ? 1 / invSize : 0;
    }
    earcutLinked(outerNode, triangles, dim, minX, minY, invSize);
    return triangles;
}

function linkedList(data, start, end, dim, clockwise) {
    var i, last;
    if (clockwise === (signedArea(data, start, end, dim) > 0)) {
        for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
    } else {
        for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
    }
    if (last && equals(last, last.next)) {
        removeNode(last);
        last = last.next;
    }
    return last;
}

function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    var p = start,
        again;
    do {
        again = false;
        if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
            removeNode(p);
            p = end = p.prev;
            if (p === p.next) break;
            again = true;
        } else {
            p = p.next;
        }
    } while (again || p !== end);
    return end;
}

function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
    var stop = ear, prev, next;
    while (ear.prev !== ear.next) {
        prev = ear.prev;
        next = ear.next;
        if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
            triangles.push(prev.i / dim);
            triangles.push(ear.i / dim);
            triangles.push(next.i / dim);
            removeNode(ear);
            ear = next.next;
            stop = next.next;
            continue;
        }
        ear = next;
        if (ear === stop) {
            if (!pass) {
                earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);
            } else if (pass === 1) {
                ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
                earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);
            } else if (pass === 2) {
                splitEarcut(ear, triangles, dim, minX, minY, invSize);
            }
            break;
        }
    }
}

function isEar(ear) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var p = ear.next.next;
    while (p !== ear.prev) {
        if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.next;
    }
    return true;
}

function isEarHashed(ear, minX, minY, invSize) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x),
        minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y),
        maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x),
        maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);
    var minZ = Math.floor((minTX - minX) * invSize),
        maxZ = Math.ceil((maxTX - minX) * invSize),
        minZ2 = Math.floor((minTY - minY) * invSize),
        maxZ2 = Math.ceil((maxTY - minY) * invSize);
    var p = ear.prevZ, n = ear.nextZ;
    while (p && p.z >= minZ && n && n.z <= maxZ) {
        if (p !== ear.prev && p !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.prevZ;
    }
    while (p && p.z >= minZ) {
        if (p !== ear.prev && p !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.prevZ;
    }
    while (n && n.z <= maxZ) {
        if (n !== ear.prev && n !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
            area(n.prev, n, n.next) >= 0) return false;
        n = n.nextZ;
    }
    return true;
}

function cureLocalIntersections(start, triangles, dim) {
    var p = start;
    do {
        var a = p.prev, b = p.next.next;
        if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
            triangles.push(a.i / dim);
            triangles.push(p.i / dim);
            triangles.push(b.i / dim);
            removeNode(p);
            removeNode(p.next);
            p = start = b;
        }
        p = p.next;
    } while (p !== start);
    return filterPoints(p);
}

function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    var a = start;
    do {
        var b = a.next.next;
        while (b !== a.prev) {
            if (a.i !== b.i && isValidDiagonal(a, b)) {
                var c = splitPolygon(a, b);
                a = filterPoints(a, a.next);
                c = filterPoints(c, c.next);
                earcutLinked(a, triangles, dim, minX, minY, invSize);
                earcutLinked(c, triangles, dim, minX, minY, invSize);
                return;
            }
            b = b.next;
        }
        a = a.next;
    } while (a !== start);
}

function eliminateHoles(data, holeIndices, outerNode, dim) {
    var queue = [], i, len, start, end, list;
    for (i = 0, len = holeIndices.length; i < len; i++) {
        start = holeIndices[i] * dim;
        end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
        list = linkedList(data, start, end, dim, false);
        if (list === list.next) list.steiner = true;
        queue.push(getLeftmost(list));
    }
    queue.sort(compareX);
    for (i = 0; i < queue.length; i++) {
        eliminateHole(queue[i], outerNode);
        outerNode = filterPoints(outerNode, outerNode.next);
    }
    return outerNode;
}

function eliminateHole(hole, outerNode) {
    outerNode = findHoleBridge(hole, outerNode);
    if (outerNode) {
        var b = splitPolygon(outerNode, hole);
        filterPoints(outerNode, outerNode.next);
        filterPoints(b, b.next);
    }
}

function findHoleBridge(hole, outerNode) {
    var p = outerNode;
    var hx = hole.x, hy = hole.y, qx = -Infinity, m;
    do {
        if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
            var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
            if (x <= hx && x > qx) {
                qx = x;
                if (x === hx) {
                    if (hy === p.y) return p;
                    if (hy === p.next.y) return p.next;
                }
                m = p.x < p.next.x ? p : p.next;
            }
        }
        p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    if (hx === qx) return m;
    var stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
    p = m;
    do {
        if (hx >= p.x && p.x >= mx && hx !== p.x &&
            pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
            tan = Math.abs(hy - p.y) / (hx - p.x);
            if (locallyInside(p, hole) &&
                (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && sectorContainsSector(m, p)))))) {
                m = p;
                tanMin = tan;
            }
        }
        p = p.next;
    } while (p !== stop);
    return m;
}

function sectorContainsSector(m, p) {
    return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

function indexCurve(start, minX, minY, invSize) {
    var p = start;
    do {
        if (p.z === null) p.z = Math.floor((p.x - minX) * invSize);
        p.prevZ = p.prev;
        p.nextZ = p.next;
        p = p.next;
    } while (p !== start);
    p.prevZ.nextZ = null;
    p.prevZ = null;
    sortLinked(p);
}

function sortLinked(list) {
    var i, p, q, e, tail, numMerges, pSize, qSize,
        inSize = 1;
    do {
        p = list;
        list = null;
        tail = null;
        numMerges = 0;
        while (p) {
            numMerges++;
            q = p;
            pSize = 0;
            for (i = 0; i < inSize; i++) {
                pSize++;
                q = q.nextZ;
                if (!q) break;
            }
            qSize = inSize;
            while (pSize > 0 || (qSize > 0 && q)) {
                if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
                    e = p;
                    p = p.nextZ;
                    pSize--;
                } else {
                    e = q;
                    q = q.nextZ;
                    qSize--;
                }
                if (tail) tail.nextZ = e;
                else list = e;
                e.prevZ = tail;
                tail = e;
            }
            p = q;
        }
        tail.nextZ = null;
        inSize *= 2;
    } while (numMerges > 1);
    return list;
}

function insertNode(i, x, y, last) {
    var p = {
        i: i,
        x: x,
        y: y,
        prev: null,
        next: null,
        z: null,
        prevZ: null,
        nextZ: null,
        steiner: false
    };
    if (!last) {
        p.prev = p;
        p.next = p;
    } else {
        p.next = last.next;
        p.prev = last;
        last.next.prev = p;
        last.next = p;
    }
    return p;
}

function removeNode(p) {
    p.next.prev = p.prev;
    p.prev.next = p.next;
    if (p.prevZ) p.prevZ.nextZ = p.nextZ;
    if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function signedArea(data, start, end, dim) {
    var sum = 0;
    for (var i = start, j = end - dim; i < end; i += dim) {
        sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
        j = i;
    }
    return sum;
}

function area(p, q, r) {
    return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

function equals(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
}

function intersects(p1, q1, p2, q2) {
    var o1 = sign(area(p1, q1, p2));
    var o2 = sign(area(p1, q1, q2));
    var o3 = sign(area(p2, q2, p1));
    var o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
}

function onSegment(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
           q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}

function sign(num) {
    return num > 0 ? 1 : num < 0 ? -1 : 0;
}

function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
           (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
           (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
}

function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
           (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
            (area(a.prev, a, b.prev) || area(a, b.prev, b)) || equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
}

function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ?
        area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
        area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

function middleInside(a, b) {
    var p = a,
        inside = false,
        px = (a.x + b.x) / 2,
        py = (a.y + b.y) / 2;
    do {
        if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
            (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
            inside = !inside;
        p = p.next;
    } while (p !== a);
    return inside;
}

function intersectsPolygon(a, b) {
    var p = a;
    do {
        if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
            intersects(p, p.next, a, b)) return true;
        p = p.next;
    } while (p !== a);
    return false;
}

function splitPolygon(a, b) {
    var a2 = { i: a.i, x: a.x, y: a.y },
        b2 = { i: b.i, x: b.x, y: b.y },
        an = a.next,
        bp = b.prev;
    a.next = b;
    b.prev = a;
    a2.next = an;
    an.prev = a2;
    b2.next = b2;
    b2.prev = b2;
    bp.next = a2;
    a2.prev = bp;
    return b2;
}

function getLeftmost(start) {
    var p = start,
        leftmost = start;
    do {
        if (p.x < leftmost.x || (p.x === leftmost.x && p.y < leftmost.y))
            leftmost = p;
        p = p.next;
    } while (p !== start);
    return leftmost;
}

function compareX(a, b) {
    return a.x - b.x;
}

// ============ 默认参数 ============
const DEFAULT_PARAMS = {
    sphere: { rx: 1.0, ry: 1.0, rz: 1.0, minVal: 0.001, maxVal: 5, units: '1' },
    cylinder: { radius: 0.8, height: 1.5, minVal: 0.001, maxVal: 5, units: '1' },
    cone: { radius: 1.0, height: 2.0, minVal: 0.001, maxVal: 5, units: '1' },
    frustum_cone: { topRadius: 0.5, bottomRadius: 1.0, height: 1.5, minVal: 0.001, maxVal: 5, units: '1' },
    torus: { tubeRadius: 0.2, ringRadius: 1.0, minVal: 0.001, maxVal: 5, units: '1' },
    pipe: { outerRadius: 0.70, innerRadius: 0.60, length: 2.00, minVal: 0.01, maxVal: 5, units: '1' },
    cube: { width: 1.5, depth: 1.5, height: 1.5, minVal: 0.001, maxVal: 10, units: '1' },
    square_tube: { outerWidth: 1.20, outerHeight: 1.20, innerWidth: 0.80, innerHeight: 0.80, length: 2.00, minVal: 0.01, maxVal: 5, units: '1' },
    pyramid: { width: 2.0, depth: 2.0, height: 2.0, minVal: 0.001, maxVal: 10, units: '1' },
    prism_frustum: { topWidth: 1.0, topDepth: 1.0, bottomWidth: 1.5, bottomDepth: 1.5, height: 1.5, minVal: 0.001, maxVal: 10, units: '1' },
    plane: { width: 1.5, height: 1.5, minVal: 0.001, maxVal: 10, units: '1' }
};

const INITIAL_MODEL_COORDS = {
    sphere: { x: 81000, y: 0, z: 0 },
    cylinder: { x: 82000, y: 0, z: 0 },
    cone: { x: 83000, y: 0, z: 0 },
    frustum_cone: { x: 84000, y: 0, z: 0 },
    torus: { x: 85000, y: 0, z: 0 },
    pipe: { x: 86000, y: 0, z: 0 },
    cube: { x: 87000, y: 0, z: 0 },
    square_tube: { x: 88000, y: 0, z: 0 },
    pyramid: { x: 89000, y: 0, z: 0 },
    prism_frustum: { x: 90000, y: 0, z: 0 },
    plane: { x: 91000, y: 0, z: 0 }
};

function getDefaultParams(shape) { return DEFAULT_PARAMS[shape] || DEFAULT_PARAMS['sphere']; }

// ============ 场景初始化 ============
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050518);
scene.fog = new THREE.FogExp2(0x050518, 0.008);

let camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.set(81005, 4, 10);
camera.lookAt(81000, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.enabled = false;
composer.addPass(fxaaPass);
let fxaaEnabled = false;
function updateFXAASize() {
    const pr = renderer.getPixelRatio();
    const w = container.clientWidth, h = container.clientHeight;
    composer.setSize(w, h);
    fxaaPass.uniforms['resolution'].value.set(1/(w*pr), 1/(h*pr));
}
updateFXAASize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(81000, 0, 0);
controls.enablePan = false;
controls.enableRotate = true;
controls.enableZoom = true;

// ---------- 光照 ----------
const targetPos = new THREE.Vector3(0, 0.8, 0);
const sharedTarget = new THREE.Object3D();
sharedTarget.position.copy(targetPos);
scene.add(sharedTarget);
const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambientLight);
const dirLightOffset = new THREE.Vector3(5, 9.2, 5);
const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
dirLight.castShadow = true; dirLight.shadow.mapSize.width = 1024; dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near = 1; dirLight.shadow.camera.far = 25; dirLight.shadow.camera.left = -12; dirLight.shadow.camera.right = 12; dirLight.shadow.camera.top = 12; dirLight.shadow.camera.bottom = -12; dirLight.shadow.bias = -0.0005;
dirLight.target = sharedTarget; scene.add(dirLight);
const fillLightOffset = new THREE.Vector3(-4, 4.2, -3);
const fillDirectionalLight = new THREE.DirectionalLight(0xaaccff, 0.7);
fillDirectionalLight.castShadow = true; fillDirectionalLight.shadow.mapSize.width = 512; fillDirectionalLight.shadow.mapSize.height = 512;
fillDirectionalLight.shadow.camera.near = 1; fillDirectionalLight.shadow.camera.far = 20; fillDirectionalLight.shadow.camera.left = -8; fillDirectionalLight.shadow.camera.right = 8; fillDirectionalLight.shadow.camera.top = 8; fillDirectionalLight.shadow.camera.bottom = -8;
fillDirectionalLight.target = sharedTarget; scene.add(fillDirectionalLight);
let pointLights = [], pointOffsets = [];
function createPointLight(offsetVec, color, intensity = 1.5, distance = 12, decay = 1) {
    const light = new THREE.PointLight(color, intensity, distance, decay);
    light.castShadow = true; light.shadow.mapSize.width = 512; light.shadow.mapSize.height = 512; light.shadow.bias = -0.0005;
    scene.add(light); return { light, offset: offsetVec.clone() };
}
const POINT_DEFAULTS = [
    { offset: new THREE.Vector3(3, 2.7, 2), color: 0xffaa66, intensity: 0, distance: 12, decay: 1 },
    { offset: new THREE.Vector3(-2.5, 3.0, -1.5), color: 0x88aaff, intensity: 0, distance: 12, decay: 1 }
];
function initPointLights() { pointLights.forEach(l=>scene.remove(l)); pointLights=[]; pointOffsets=[]; POINT_DEFAULTS.forEach(cfg=>{ const p=createPointLight(cfg.offset,cfg.color,cfg.intensity,cfg.distance,cfg.decay); pointLights.push(p.light); pointOffsets.push(p.offset); }); }
initPointLights();
let spotLights = [], spotOffsets = [];
function createSpotLight(offsetVec, color, intensity = 2.0, distance = 25, angle = 0.6, penumbra = 0.3, decay = 1.0) {
    const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
    light.castShadow = true; light.shadow.mapSize.width = 1024; light.shadow.mapSize.height = 1024; light.shadow.bias = -0.0005;
    light.target = sharedTarget; scene.add(light); return { light, offset: offsetVec.clone() };
}
const SPOT_DEFAULTS = [
    { offset: new THREE.Vector3(-2, 6.2, 4), color: 0xddbbff, intensity: 0, distance: 25, angle: 0.6, penumbra: 0.3, decay: 1.0 }
];
function initSpotLights() { spotLights.forEach(l=>scene.remove(l)); spotLights=[]; spotOffsets=[]; SPOT_DEFAULTS.forEach(cfg=>{ const s=createSpotLight(cfg.offset.clone(),cfg.color,cfg.intensity,cfg.distance,cfg.angle,cfg.penumbra,cfg.decay); spotLights.push(s.light); spotOffsets.push(s.offset); }); }
initSpotLights();
function updateAllLightPositions() {
    sharedTarget.position.copy(targetPos);
    dirLight.position.copy(targetPos.clone().add(dirLightOffset));
    fillDirectionalLight.position.copy(targetPos.clone().add(fillLightOffset));
    pointLights.forEach((l,i)=>l.position.copy(targetPos.clone().add(pointOffsets[i])));
    spotLights.forEach((l,i)=>l.position.copy(targetPos.clone().add(spotOffsets[i])));
}
updateAllLightPositions();

let lightGui;
const lightGuiContainer = document.getElementById('lighting-controls-container');
function rebuildLightGUI() {
    if(lightGui) lightGui.destroy();
    lightGui = new GUI({ container: lightGuiContainer, title:'光源参数' });
    lightGui.domElement.querySelector('.title')?.remove();
    const af=lightGui.addFolder('环境光'); af.add(ambientLight,'intensity',0,2.5,0.01).name('强度'); af.addColor({color:ambientLight.color.getHex()},'color').name('颜色').onChange(v=>ambientLight.color.set(v)); af.open();
    const df=lightGui.addFolder('主平行光'); df.add(dirLight,'intensity',0,3,0.01).name('强度'); df.addColor({color:dirLight.color.getHex()},'color').name('颜色').onChange(v=>dirLight.color.set(v)); df.add(dirLightOffset,'x',-10,10,0.1).name('偏离X').onChange(updateAllLightPositions); df.add(dirLightOffset,'y',-5,15,0.1).name('偏离Y').onChange(updateAllLightPositions); df.add(dirLightOffset,'z',-10,10,0.1).name('偏离Z').onChange(updateAllLightPositions); df.open();
    const ff=lightGui.addFolder('辅平行光'); ff.add(fillDirectionalLight,'intensity',0,2,0.01).name('强度'); ff.addColor({color:fillDirectionalLight.color.getHex()},'color').name('颜色').onChange(v=>fillDirectionalLight.color.set(v)); ff.add(fillLightOffset,'x',-10,10,0.1).name('偏离X').onChange(updateAllLightPositions); ff.add(fillLightOffset,'y',-5,15,0.1).name('偏离Y').onChange(updateAllLightPositions); ff.add(fillLightOffset,'z',-10,10,0.1).name('偏离Z').onChange(updateAllLightPositions); ff.open();
    const pf=lightGui.addFolder('点光源'); pointLights.forEach((l,i)=>{ const s=pf.addFolder(`点光源${i+1}`); s.add(l,'intensity',0,4,0.05).name('强度'); s.addColor({color:l.color.getHex()},'color').name('颜色').onChange(v=>l.color.set(v)); s.add(l,'distance',0,30,0.5).name('距离'); s.add(l,'decay',0.5,2.5,0.1).name('衰减'); s.add(pointOffsets[i],'x',-8,8,0.1).name('偏离X').onChange(updateAllLightPositions); s.add(pointOffsets[i],'y',-2,10,0.1).name('偏离Y').onChange(updateAllLightPositions); s.add(pointOffsets[i],'z',-8,8,0.1).name('偏离Z').onChange(updateAllLightPositions); s.open(); }); pf.open();
    const sf=lightGui.addFolder('聚光灯'); spotLights.forEach((l,i)=>{ const s=sf.addFolder(`聚光灯${i+1}`); s.add(l,'intensity',0,5,0.05).name('强度'); s.addColor({color:l.color.getHex()},'color').name('颜色').onChange(v=>l.color.set(v)); s.add(l,'distance',0,40,0.5).name('距离'); s.add(l,'angle',0.1,1.2,0.01).name('角度'); s.add(l,'penumbra',0,1,0.01).name('边缘柔化'); s.add(l,'decay',0.5,2.5,0.1).name('衰减'); s.add(spotOffsets[i],'x',-8,8,0.1).name('偏离X').onChange(updateAllLightPositions); s.add(spotOffsets[i],'y',-2,12,0.1).name('偏离Y').onChange(updateAllLightPositions); s.add(spotOffsets[i],'z',-8,8,0.1).name('偏离Z').onChange(updateAllLightPositions); s.open(); }); sf.open();
}
rebuildLightGUI();

function addPointLight() { const p = createPointLight(new THREE.Vector3(1.5,2.5,1.5), 0xffaa66 + pointLights.length*0x111111, 1.5, 12, 1); pointLights.push(p.light); pointOffsets.push(p.offset); updateAllLightPositions(); rebuildLightGUI(); }
function removePointLight() { if (pointLights.length <= 1) return; const last = pointLights.pop(); scene.remove(last); pointOffsets.pop(); updateAllLightPositions(); rebuildLightGUI(); }
function resetLighting() {
    ambientLight.intensity = 0.6; ambientLight.color.set(0x404060);
    dirLight.intensity = 1.2; dirLight.color.set(0xfff5e6); dirLightOffset.set(5,9.2,5);
    fillDirectionalLight.intensity = 0.7; fillDirectionalLight.color.set(0xaaccff); fillLightOffset.set(-4,4.2,-3);
    pointLights.forEach(l=>scene.remove(l)); pointLights=[]; pointOffsets=[];
    POINT_DEFAULTS.forEach(c=>{ const p = createPointLight(c.offset.clone(),c.color,c.intensity,c.distance,c.decay); pointLights.push(p.light); pointOffsets.push(p.offset); });
    spotLights.forEach(l=>scene.remove(l)); spotLights=[]; spotOffsets=[];
    SPOT_DEFAULTS.forEach(c=>{ const s = createSpotLight(c.offset.clone(),c.color,c.intensity,c.distance,c.angle,c.penumbra,c.decay); spotLights.push(s.light); spotOffsets.push(s.offset); });
    updateAllLightPositions(); rebuildLightGUI();
}

const gridHelper = new THREE.GridHelper(12,28,0x99bbff,0x5577aa); gridHelper.position.y=-1.2; gridHelper.material.transparent=true; gridHelper.material.opacity=0.35; gridHelper.visible=false; scene.add(gridHelper);
const axesHelper = new THREE.AxesHelper(3.5); axesHelper.material.transparent=true; axesHelper.material.opacity=0.15; scene.add(axesHelper);
const groundMesh = new THREE.Mesh(new THREE.CircleGeometry(10,64), new THREE.MeshStandardMaterial({color:0x888888,roughness:0.8,side:THREE.DoubleSide})); groundMesh.rotation.x=-Math.PI/2; groundMesh.position.y=-0.01; groundMesh.receiveShadow=true; groundMesh.visible=false; scene.add(groundMesh);

// ========== 工具函数 ==========
function getModelMeshes(model) { const meshes = []; model.traverse((child) => { if (child.isMesh) meshes.push(child); }); return meshes; }
function createBrightMaterial(color, metalness=0.85, roughness=0.25, emissiveIntensity=0.1){ return new THREE.MeshStandardMaterial({color,metalness,roughness,side:THREE.DoubleSide,emissive:color,emissiveIntensity}); }
function createTexturedMaterial(baseColor, texture){ if(texture&&texture.isTexture) return new THREE.MeshStandardMaterial({map:texture,metalness:0.7,roughness:0.3,side:THREE.DoubleSide,color:0xffffff}); return createBrightMaterial(baseColor); }

// ========== 辅助几何体生成器（水密、单一 BufferGeometry） ==========
function generateTubeGeometry(or,ir,h,rs=64){ 
    if(ir>=or) ir=or*0.98; if(ir<0.01) ir=0.01; or=Math.max(0.01,or); const hh=h/2, v=[], idx=[], n=[]; 
    function av(x,y,z,nx,ny,nz){ v.push(x,y,z); n.push(nx,ny,nz); return (v.length/3)-1; } 
    for(let i=0;i<=rs;i++){ const a=(i/rs)*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a); const x=or*ca, z=or*sa; const ib=av(x,-hh,z,ca,0,sa), it=av(x,hh,z,ca,0,sa); if(i>0){ const pb=ib-2, pt=it-2; idx.push(pb,ib,pt,ib,it,pt); } } 
    for(let i=0;i<=rs;i++){ const a=(i/rs)*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a); const x=ir*ca, z=ir*sa; const ib=av(x,-hh,z,-ca,0,-sa), it=av(x,hh,z,-ca,0,-sa); if(i>0){ const pb=ib-2, pt=it-2; idx.push(pb,pt,ib,ib,pt,it); } } 
    const tor=[], tir=[], bor=[], bir=[]; 
    for(let i=0;i<=rs;i++){ const a=(i/rs)*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a); tor.push(av(or*ca,hh,or*sa,0,1,0)); tir.push(av(ir*ca,hh,ir*sa,0,1,0)); bor.push(av(or*ca,-hh,or*sa,0,-1,0)); bir.push(av(ir*ca,-hh,ir*sa,0,-1,0)); } 
    for(let i=0;i<rs;i++){ const o1=tor[i],o2=tor[i+1],i1=tir[i],i2=tir[i+1]; idx.push(o1,o2,i1,i1,o2,i2); const bo1=bor[i],bo2=bor[i+1],bi1=bir[i],bi2=bir[i+1]; idx.push(bo1,bi1,bo2,bi1,bi2,bo2); } 
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(v),3)); g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(n),3)); g.setIndex(idx); g.computeVertexNormals(); return g; 
}

function generateSquareTubeGeometry(ow, oh, iw, ih, len) {
    const hw = ow/2, hh = oh/2, hiw = iw/2, hih = ih/2, hl = len/2;
    const positions = [], normals = [];
    function addQuad(p1, p2, p3, p4, normal) {
        const addTri = (a,b,c) => {
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
        };
        addTri(p1, p2, p3);
        addTri(p1, p3, p4);
    }
    // 外表面
    addQuad(new THREE.Vector3(-hw, -hl, -hh), new THREE.Vector3( hw, -hl, -hh), new THREE.Vector3( hw,  hl, -hh), new THREE.Vector3(-hw,  hl, -hh), new THREE.Vector3(0,0,-1));
    addQuad(new THREE.Vector3( hw, -hl,  hh), new THREE.Vector3(-hw, -hl,  hh), new THREE.Vector3(-hw,  hl,  hh), new THREE.Vector3( hw,  hl,  hh), new THREE.Vector3(0,0,1));
    addQuad(new THREE.Vector3(-hw, -hl,  hh), new THREE.Vector3(-hw, -hl, -hh), new THREE.Vector3(-hw,  hl, -hh), new THREE.Vector3(-hw,  hl,  hh), new THREE.Vector3(-1,0,0));
    addQuad(new THREE.Vector3( hw, -hl, -hh), new THREE.Vector3( hw, -hl,  hh), new THREE.Vector3( hw,  hl,  hh), new THREE.Vector3( hw,  hl, -hh), new THREE.Vector3(1,0,0));
    // 内表面法线指向内部
    addQuad(new THREE.Vector3( hiw, -hl, -hih), new THREE.Vector3(-hiw, -hl, -hih), new THREE.Vector3(-hiw,  hl, -hih), new THREE.Vector3( hiw,  hl, -hih), new THREE.Vector3(0,0,1));
    addQuad(new THREE.Vector3(-hiw, -hl,  hih), new THREE.Vector3( hiw, -hl,  hih), new THREE.Vector3( hiw,  hl,  hih), new THREE.Vector3(-hiw,  hl,  hih), new THREE.Vector3(0,0,-1));
    addQuad(new THREE.Vector3(-hiw, -hl, -hih), new THREE.Vector3(-hiw, -hl,  hih), new THREE.Vector3(-hiw,  hl,  hih), new THREE.Vector3(-hiw,  hl, -hih), new THREE.Vector3(1,0,0));
    addQuad(new THREE.Vector3( hiw, -hl,  hih), new THREE.Vector3( hiw, -hl, -hih), new THREE.Vector3( hiw,  hl, -hih), new THREE.Vector3( hiw,  hl,  hih), new THREE.Vector3(-1,0,0));
    // 顶部和底部环面
    addQuad(new THREE.Vector3(-hw, hl, -hh), new THREE.Vector3( hw, hl, -hh), new THREE.Vector3( hiw, hl, -hih), new THREE.Vector3(-hiw, hl, -hih), new THREE.Vector3(0,1,0));
    addQuad(new THREE.Vector3( hw, hl,  hh), new THREE.Vector3(-hw, hl,  hh), new THREE.Vector3(-hiw, hl,  hih), new THREE.Vector3( hiw, hl,  hih), new THREE.Vector3(0,1,0));
    addQuad(new THREE.Vector3(-hw, hl,  hh), new THREE.Vector3(-hw, hl, -hh), new THREE.Vector3(-hiw, hl, -hih), new THREE.Vector3(-hiw, hl,  hih), new THREE.Vector3(0,1,0));
    addQuad(new THREE.Vector3( hw, hl, -hh), new THREE.Vector3( hw, hl,  hh), new THREE.Vector3( hiw, hl,  hih), new THREE.Vector3( hiw, hl, -hih), new THREE.Vector3(0,1,0));
    addQuad(new THREE.Vector3( hw, -hl, -hh), new THREE.Vector3(-hw, -hl, -hh), new THREE.Vector3(-hiw, -hl, -hih), new THREE.Vector3( hiw, -hl, -hih), new THREE.Vector3(0,-1,0));
    addQuad(new THREE.Vector3(-hw, -hl,  hh), new THREE.Vector3( hw, -hl,  hh), new THREE.Vector3( hiw, -hl,  hih), new THREE.Vector3(-hiw, -hl,  hih), new THREE.Vector3(0,-1,0));
    addQuad(new THREE.Vector3(-hw, -hl, -hh), new THREE.Vector3(-hw, -hl,  hh), new THREE.Vector3(-hiw, -hl,  hih), new THREE.Vector3(-hiw, -hl, -hih), new THREE.Vector3(0,-1,0));
    addQuad(new THREE.Vector3( hw, -hl,  hh), new THREE.Vector3( hw, -hl, -hh), new THREE.Vector3( hiw, -hl, -hih), new THREE.Vector3( hiw, -hl,  hih), new THREE.Vector3(0,-1,0));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
}

function createPyramidGeometry(w, d, h) {
    const hw = w/2, hd = d/2, baseY = -h/2, apexY = h/2;
    const positions = [], normals = [];
    function addTri(a, b, c, normal) {
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
    }
    const v0 = new THREE.Vector3(-hw, baseY, -hd);
    const v1 = new THREE.Vector3( hw, baseY, -hd);
    const v2 = new THREE.Vector3( hw, baseY,  hd);
    const v3 = new THREE.Vector3(-hw, baseY,  hd);
    const apex = new THREE.Vector3(0, apexY, 0);
    addTri(v1, v0, v2, new THREE.Vector3(0,-1,0));
    addTri(v1, v2, v3, new THREE.Vector3(0,-1,0));
    const nFront = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(v1, v0), new THREE.Vector3().subVectors(apex, v0)).normalize();
    addTri(v0, v1, apex, nFront);
    const nRight = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(v2, v1), new THREE.Vector3().subVectors(apex, v1)).normalize();
    addTri(v1, v2, apex, nRight);
    const nBack = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(v3, v2), new THREE.Vector3().subVectors(apex, v2)).normalize();
    addTri(v2, v3, apex, nBack);
    const nLeft = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(v0, v3), new THREE.Vector3().subVectors(apex, v3)).normalize();
    addTri(v3, v0, apex, nLeft);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
}

function createPrismFrustumGeometry(tw, td, bw, bd, h) {
    const htw = tw/2, htd = td/2, hbw = bw/2, hbd = bd/2;
    const yt = h/2, yb = -h/2;
    const positions = [], normals = [];
    function addQuad(p1, p2, p3, p4, normal) {
        const addTri = (a,b,c) => {
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
            normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
        };
        addTri(p1, p2, p3);
        addTri(p1, p3, p4);
    }
    const t0 = new THREE.Vector3(-htw, yt, -htd), t1 = new THREE.Vector3( htw, yt, -htd);
    const t2 = new THREE.Vector3( htw, yt,  htd), t3 = new THREE.Vector3(-htw, yt,  htd);
    const b0 = new THREE.Vector3(-hbw, yb, -hbd), b1 = new THREE.Vector3( hbw, yb, -hbd);
    const b2 = new THREE.Vector3( hbw, yb,  hbd), b3 = new THREE.Vector3(-hbw, yb,  hbd);
    addQuad(t0, t3, t2, t1, new THREE.Vector3(0,1,0));
    addQuad(b0, b1, b2, b3, new THREE.Vector3(0,-1,0));
    addQuad(t0, t1, b1, b0, new THREE.Vector3(0,0,-1));
    addQuad(t2, t3, b3, b2, new THREE.Vector3(0,0,1));
    addQuad(t3, t0, b0, b3, new THREE.Vector3(-1,0,0));
    addQuad(t1, t2, b2, b1, new THREE.Vector3(1,0,0));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
}

// ========== 纹理存储 ==========
const textureStore = {};
const shapeFacesDef = {
    sphere:{outer:['外球面'],inner:['内球面']}, cylinder:{outer:['外顶面','外底面','外柱面'],inner:['内顶面','内底面','内柱面']},
    cone:{outer:['外底面','外锥面'],inner:['内底面','内锥面']}, frustum_cone:{outer:['外顶面','外底面','外侧面'],inner:['内顶面','内底面','内侧面']},
    torus:{outer:['外环面'],inner:['内环面']}, pipe:{outer:['外顶面','外底面','外侧面'],inner:['内侧面']},
    cube:{outer:['外上','外下','外前','外后','外左','外右'],inner:['内上','内下','内前','内后','内左','内右']},
    square_tube:{outer:['外顶面','外底面','外前','外后','外左','外右'],inner:['内前','内后','内左','内右']},
    pyramid:{outer:['外底面','外前','外后','外左','外右'],inner:['内底面','内前','内后','内左','内右']},
    prism_frustum:{outer:['外顶面','外底面','外前','外后','外左','外右'],inner:['内顶面','内底面','内前','内后','内左','内右']},
    plane:{outer:['正面','背面'],inner:[]}
};
function getTextureKey(shape,face){ return `${shape}|||${face}`; }
function hasTextureForFace(shape,face){ return !!textureStore[getTextureKey(shape,face)]; }
function getTextureForFace(shape,face){ return textureStore[getTextureKey(shape,face)]||null; }
function setTextureForFace(shape,face,tex){ textureStore[getTextureKey(shape,face)]=tex; }
function removeTextureForFace(shape,face){ const k=getTextureKey(shape,face); if(textureStore[k]){ if(textureStore[k].dispose) textureStore[k].dispose(); delete textureStore[k]; } }
function getAllFacesForShape(shape){ const d=shapeFacesDef[shape]; if(!d)return[]; return[...(d.outer||[]),...(d.inner||[])]; }

// ========== 形状创建函数（水密、单一封闭网格） ==========
function createBasicSphere(){
    const tex = getTextureForFace('sphere','外球面');
    const geo = new THREE.SphereGeometry(1,64,64);
    const mat = tex ? createTexturedMaterial(0xff6600, tex) : createBrightMaterial(0xff6600,0.78,0.22,0.12);
    mat.side = THREE.FrontSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.shape = 'sphere';
    return mesh;
}

function createBasicCylinder(){
    const r = parseFloat(document.getElementById('radius-slider')?.value)||0.8;
    const h = parseFloat(document.getElementById('height-slider')?.value)||1.5;
    const geo = new THREE.CylinderGeometry(r, r, h, 64);
    const materials = [
        getTextureForFace('cylinder','外柱面') ? createTexturedMaterial(0xff3333, getTextureForFace('cylinder','外柱面')) : createBrightMaterial(0xff3333,0.82,0.2,0.1),
        getTextureForFace('cylinder','外顶面') ? createTexturedMaterial(0xff3333, getTextureForFace('cylinder','外顶面')) : createBrightMaterial(0xff3333,0.82,0.2,0.1),
        getTextureForFace('cylinder','外底面') ? createTexturedMaterial(0xff3333, getTextureForFace('cylinder','外底面')) : createBrightMaterial(0xff3333,0.82,0.2,0.1)
    ];
    materials.forEach(m => m.side = THREE.DoubleSide);
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.userData.shape = 'cylinder';
    return mesh;
}

function createBasicCone(){
    const r = parseFloat(document.getElementById('cone-radius-slider')?.value)||1.0;
    const h = parseFloat(document.getElementById('cone-height-slider')?.value)||2.0;
    const geo = new THREE.CylinderGeometry(0, r, h, 64);
    const materials = [
        getTextureForFace('cone','外锥面') ? createTexturedMaterial(0x5fad56, getTextureForFace('cone','外锥面')) : new THREE.MeshStandardMaterial({color:0x5fad56,metalness:0.7,roughness:0.26,side:THREE.DoubleSide}),
        getTextureForFace('cone','外底面') ? createTexturedMaterial(0x5fad56, getTextureForFace('cone','外底面')) : new THREE.MeshStandardMaterial({color:0x5fad56,metalness:0.7,roughness:0.26,side:THREE.DoubleSide})
    ];
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.userData.shape = 'cone';
    return mesh;
}

function createBasicFrustum(){
    const tr = parseFloat(document.getElementById('top-radius-slider')?.value)||0.5;
    const br = parseFloat(document.getElementById('bottom-radius-slider')?.value)||1.0;
    const h = parseFloat(document.getElementById('frustum-height-slider')?.value)||1.5;
    const geo = new THREE.CylinderGeometry(tr, br, h, 64);
    const materials = [
        getTextureForFace('frustum_cone','外侧面') ? createTexturedMaterial(0xcc8855, getTextureForFace('frustum_cone','外侧面')) : new THREE.MeshStandardMaterial({color:0xcc8855,metalness:0.72,roughness:0.28,side:THREE.DoubleSide}),
        getTextureForFace('frustum_cone','外顶面') ? createTexturedMaterial(0xcc8855, getTextureForFace('frustum_cone','外顶面')) : new THREE.MeshStandardMaterial({color:0xcc8855,metalness:0.72,roughness:0.28,side:THREE.DoubleSide}),
        getTextureForFace('frustum_cone','外底面') ? createTexturedMaterial(0xcc8855, getTextureForFace('frustum_cone','外底面')) : new THREE.MeshStandardMaterial({color:0xcc8855,metalness:0.72,roughness:0.28,side:THREE.DoubleSide})
    ];
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.userData.shape = 'frustum_cone';
    return mesh;
}

function createBasicTorus(){
    const tr = parseFloat(document.getElementById('tube-radius-slider')?.value)||0.2;
    const rr = parseFloat(document.getElementById('ring-radius-slider')?.value)||1.0;
    const tex = getTextureForFace('torus','外环面');
    const geo = new THREE.TorusGeometry(rr, tr, 64, 128);
    const mat = tex ? createTexturedMaterial(0x228B22, tex) : new THREE.MeshStandardMaterial({color:0x228B22,metalness:0.7,roughness:0.3,side:THREE.FrontSide});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI/2;
    mesh.userData.shape = 'torus';
    return mesh;
}

function createPrecisePipeMesh(or, ir, len) {
    const geo = generateTubeGeometry(or, ir, len, 72);
    const tex = getTextureForFace('pipe', '外侧面');
    const mat = tex ? createTexturedMaterial(0xffaa44, tex) : createBrightMaterial(0xffaa44, 0.92, 0.22, 0.12);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.shape = 'pipe';
    return mesh;
}

function createExtrudeSquareTube(ow, oh, iw, ih, len) {
    const geo = generateSquareTubeGeometry(ow, oh, iw, ih, len);
    const tex = getTextureForFace('square_tube', '外侧面') || getTextureForFace('square_tube', '外顶面') || getTextureForFace('square_tube', '外底面');
    const mat = tex ? createTexturedMaterial(0xaa66ff, tex) : createBrightMaterial(0xaa66ff, 0.92, 0.22, 0.12);
    mat.flatShading = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.shape = 'square_tube';
    return mesh;
}

function createBasicPyramid(){
    const w = parseFloat(document.getElementById('pyramid-width-slider')?.value)||2.0;
    const d = parseFloat(document.getElementById('pyramid-depth-slider')?.value)||2.0;
    const h = parseFloat(document.getElementById('pyramid-height-slider')?.value)||2.0;
    const geo = createPyramidGeometry(w, d, h);
    const tex = getTextureForFace('pyramid','外底面') || getTextureForFace('pyramid','外前');
    const mat = tex ? createTexturedMaterial(0x5a9eff, tex) : new THREE.MeshStandardMaterial({color:0x5a9eff,metalness:0.68,roughness:0.26,side:THREE.DoubleSide});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.shape = 'pyramid';
    return mesh;
}

function createPrismFrustumWithParams(tw,td,bw,bd,h){
    const geo = createPrismFrustumGeometry(tw, td, bw, bd, h);
    const tex = getTextureForFace('prism_frustum','外顶面') || getTextureForFace('prism_frustum','外底面');
    const mat = tex ? createTexturedMaterial(0xdd8866, tex) : new THREE.MeshStandardMaterial({color:0xdd8866,metalness:0.68,roughness:0.26,side:THREE.DoubleSide});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.shape = 'prism_frustum';
    return mesh;
}

function createBasicCube(){
    const w = parseFloat(document.getElementById('cube-width-slider')?.value)||1.5;
    const d = parseFloat(document.getElementById('cube-depth-slider')?.value)||1.5;
    const h = parseFloat(document.getElementById('cube-height-slider')?.value)||1.5;
    const geo = new THREE.BoxGeometry(w, h, d);
    const faces = ['外右','外左','外上','外下','外前','外后'];
    const materials = faces.map(face => {
        const tex = getTextureForFace('cube', face);
        return tex ? createTexturedMaterial(0x33ccff, tex) : createBrightMaterial(0x33ccff,0.85,0.2,0.1);
    });
    const mesh = new THREE.Mesh(geo, materials);
    mesh.castShadow = true;
    mesh.userData.shape = 'cube';
    return mesh;
}

function createPlaneModel() {
    const w = parseFloat(document.getElementById('plane-width-slider')?.value) || 1.5;
    const d = parseFloat(document.getElementById('plane-height-slider')?.value) || 1.5;
    if (currentVideoMode === 'horizontal' && horizontalVideos.length > 0) {
        return createHorizontalVideoWall(w, d);
    }
    if (currentVideoMode === 'vertical' && verticalVideos.length > 0) {
        return createVerticalVideoWall(w, d);
    }
    if (currentVideoMode === 'dual' && isDualMode) {
        const tex = activeDualVideo === 'horizontal' ? dualHorizontalTexture : dualVerticalTexture;
        const mat = tex ? new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }) : createBrightMaterial(0xffdd44, 0.65, 0.3, 0.08);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
        mesh.castShadow = true;
        mesh.userData.isVideoItem = true;
        mesh.userData.videoIndex = -1;
        return mesh;
    }
    return createSimplePlane(w, d);
}
function createSimplePlane(width, depth, thickness = 0.01, color = 0xffdd44) {
    const tf = getTextureForFace('plane', '正面');
    const mat = tf ? createTexturedMaterial(color, tf) : createBrightMaterial(color, 0.65, 0.3, 0.08);
    let geo;
    const p = new THREE.Mesh();
    if (planeOrientation === 'front') {
        geo = new THREE.BoxGeometry(width, depth, thickness);
        p.rotation.set(0, 0, 0);
    } else if (planeOrientation === 'up') {
        geo = new THREE.BoxGeometry(width, thickness, depth);
        p.rotation.set(0, 0, 0);
    } else if (planeOrientation === 'left') {
        geo = new THREE.BoxGeometry(width, depth, thickness);
        p.rotation.y = -Math.PI / 2;
    } else {
        geo = new THREE.BoxGeometry(width, thickness, depth);
        p.rotation.set(0, 0, 0);
    }
    p.geometry = geo;
    p.material = mat;
    p.position.set(0, 0, 0);
    p.castShadow = true;
    return p;
}
// ========== CSG 引擎与依赖 ==========
const _vec = new THREE.Vector3();
const _tri = new THREE.Triangle();

function _splitPolygon(poly, planeNormal, planePoint) {
    const eps = 1e-6;
    const verts = poly.vertices;
    const n = verts.length;
    const frontVerts = [], backVerts = [];
    for (let i = 0; i < n; i++) {
        const v = verts[i];
        const d = planeNormal.dot(v) - planeNormal.dot(planePoint);
        const side = d > eps ? 1 : (d < -eps ? -1 : 0);
        if (side === 1) frontVerts.push(v.clone());
        else if (side === -1) backVerts.push(v.clone());
        else { frontVerts.push(v.clone()); backVerts.push(v.clone()); }
        const v2 = verts[(i + 1) % n];
        const d2 = planeNormal.dot(v2) - planeNormal.dot(planePoint);
        const side2 = d2 > eps ? 1 : (d2 < -eps ? -1 : 0);
        if ((side === 1 && side2 === -1) || (side === -1 && side2 === 1)) {
            const denom = planeNormal.dot(v2.clone().sub(v));
            if (Math.abs(denom) > eps) {
                const t = (planeNormal.dot(planePoint) - planeNormal.dot(v)) / denom;
                if (t > 0 && t < 1) {
                    const inter = v.clone().lerp(v2, t);
                    frontVerts.push(inter);
                    backVerts.push(inter.clone());
                }
            }
        }
    }
    const result = [];
    if (frontVerts.length >= 3)
        result.push({ vertices: frontVerts, normal: poly.normal.clone() });
    if (backVerts.length >= 3)
        result.push({ vertices: backVerts, normal: poly.normal.clone() });
    return result;
}

class BSPNode {
    constructor(polygons) {
        this.plane = null;
        this.planePoint = null;
        this.front = null;
        this.back = null;
        this.polygons = [];
        if (polygons && polygons.length) this.build(polygons);
    }
    build(polygons) {
        if (!polygons || polygons.length === 0) return;
        if (!this.plane) {
            this.plane = polygons[0].normal.clone().normalize();
            this.planePoint = polygons[0].vertices[0].clone();
        }
        const front = [], back = [], coincident = [];
        polygons.forEach(poly => {
            const c = this._classify(poly);
            if (c === 'front') front.push(poly);
            else if (c === 'back') back.push(poly);
            else if (c === 'coincident') coincident.push(poly);
            else {
                const parts = _splitPolygon(poly, this.plane, this.planePoint);
                if (parts[0]) front.push(parts[0]);
                if (parts[1]) back.push(parts[1]);
            }
        });
        const ensureConsistentWinding = (poly) => {
            if (poly.vertices.length < 3) return;
            const v0 = poly.vertices[0], v1 = poly.vertices[1], v2 = poly.vertices[2];
            const edge1 = v1.clone().sub(v0), edge2 = v2.clone().sub(v0);
            const cross = edge1.cross(edge2);
            if (cross.dot(poly.normal) < 0) {
                poly.vertices.reverse();
            }
        };
        coincident.forEach(ensureConsistentWinding);
        front.forEach(ensureConsistentWinding);
        back.forEach(ensureConsistentWinding);

        this.polygons = coincident;
        if (front.length) this.front = new BSPNode(front);
        if (back.length) this.back = new BSPNode(back);
    }
    _classify(poly) {
        const eps = 1e-6;
        let fc = 0, bc = 0;
        poly.vertices.forEach(v => {
            const d = this.plane.dot(v) - this.plane.dot(this.planePoint);
            if (d > eps) fc++;
            else if (d < -eps) bc++;
        });
        if (fc > 0 && bc === 0) return 'front';
        if (bc > 0 && fc === 0) return 'back';
        if (fc === 0 && bc === 0) return 'coincident';
        return 'spanning';
    }
    clipPolygons(polygons, keepFront = true) {
        if (!this.plane) {
            return keepFront ? polygons.slice() : [];
        }
        const front = [], back = [];
        polygons.forEach(poly => {
            const c = this._classify(poly);
            if (c === 'front') {
                front.push(poly);
            } else if (c === 'back') {
                back.push(poly);
            } else if (c === 'spanning') {
                const parts = _splitPolygon(poly, this.plane, this.planePoint);
                if (parts[0]) front.push(parts[0]);
                if (parts[1]) back.push(parts[1]);
            } else {
                (keepFront ? front : back).push(poly);
            }
        });
        let result = [];
        if (keepFront) {
            result = result.concat(
                this.front ? this.front.clipPolygons(front, true) : front
            );
            if (this.back) this.back.clipPolygons(back, true);
        } else {
            result = result.concat(
                this.back ? this.back.clipPolygons(back, false) : back
            );
            if (this.front) this.front.clipPolygons(front, false);
        }
        return result;
    }
    allPolygons() {
        let polys = this.polygons.slice();
        if (this.front) polys.push(...this.front.allPolygons());
        if (this.back) polys.push(...this.back.allPolygons());
        return polys;
    }
    invert() {
        this.polygons.forEach(p => p.normal.multiplyScalar(-1));
        if (this.plane) this.plane.multiplyScalar(-1);
        if (this.front) this.front.invert();
        if (this.back) this.back.invert();
        [this.front, this.back] = [this.back, this.front];
    }
}

class CSG {
    constructor() { this.polygons = []; }
    static fromMesh(mesh) {
        const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const posAttr = geo.getAttribute('position');
        const csg = new CSG();
        const matrix = mesh.matrixWorld.clone();
        for (let i = 0; i < posAttr.count; i += 3) {
            const verts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
            for (let j = 0; j < 3; j++) {
                verts[j].fromBufferAttribute(posAttr, i + j);
                verts[j].applyMatrix4(matrix);
            }
            _tri.set(verts[0], verts[1], verts[2]);
            const normal = _tri.getNormal(new THREE.Vector3());
            const winding = verts[1].clone().sub(verts[0]).cross(verts[2].clone().sub(verts[0]));
            if (winding.dot(normal) < 0) {
                verts.reverse();
                normal.multiplyScalar(-1);
            }
            csg.polygons.push({ vertices: verts.map(v => v.clone()), normal });
        }
        return csg;
    }
    toMesh(material) {
        const allVertices = [];
        const posArr = [];
        const vertMap = new Map();

        const getVertexIndex = (v) => {
            const key = `${v.x.toFixed(8)}_${v.y.toFixed(8)}_${v.z.toFixed(8)}`;
            if (vertMap.has(key)) return vertMap.get(key);
            const idx = allVertices.length;
            allVertices.push(v.clone());
            posArr.push(v.x, v.y, v.z);
            vertMap.set(key, idx);
            return idx;
        };

        const validPolygons = this.polygons.filter(p => p.vertices.length >= 3);
        const indices = [];

        validPolygons.forEach(poly => {
            const verts = poly.vertices;
            const normal = poly.normal.clone().normalize();

            const up = Math.abs(normal.y) < 0.999
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(1, 0, 0);
            const axisX = new THREE.Vector3().crossVectors(up, normal).normalize();
            const axisY = new THREE.Vector3().crossVectors(normal, axisX).normalize();

            const contour2D = verts.map(v => new THREE.Vector2(v.dot(axisX), v.dot(axisY)));

            const area = this._polygonArea(contour2D);
            if (area > 0) contour2D.reverse();

            const flat = [];
            for (let i = 0; i < contour2D.length; i++) {
                flat.push(contour2D[i].x, contour2D[i].y);
            }

            let tri;
            try {
                tri = earcut(flat, null, 2);
            } catch (e) {
                console.warn('Earcut triangulation failed:', e);
                return;
            }
            if (!tri || tri.length < 3) return;

            const indexMap = verts.map(v => getVertexIndex(v));

            for (let i = 0; i < tri.length; i += 3) {
                const i0 = indexMap[tri[i]];
                const i1 = indexMap[tri[i + 1]];
                const i2 = indexMap[tri[i + 2]];
                if (i0 === undefined || i1 === undefined || i2 === undefined) continue;
                indices.push(i0, i1, i2);
            }
        });

        if (indices.length === 0) {
            return new THREE.Mesh(
                new THREE.BufferGeometry(),
                material || new THREE.MeshNormalMaterial()
            );
        }

        const finalNormals = new Float32Array(allVertices.length * 3);
        validPolygons.forEach(poly => {
            const n = poly.normal.clone().normalize();
            poly.vertices.forEach(v => {
                const idx = getVertexIndex(v);
                if (idx >= 0 && idx < allVertices.length) {
                    finalNormals[idx * 3] = n.x;
                    finalNormals[idx * 3 + 1] = n.y;
                    finalNormals[idx * 3 + 2] = n.z;
                }
            });
        });

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(finalNormals, 3));
        geo.setIndex(indices);
        geo.computeBoundingSphere();
        return new THREE.Mesh(geo, material || new THREE.MeshNormalMaterial());
    }

    _polygonArea(contour) {
        let area = 0;
        const n = contour.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += contour[i].x * contour[j].y;
            area -= contour[j].x * contour[i].y;
        }
        return area / 2;
    }

    static union(a, b) {
        const bspA = new BSPNode(a.polygons);
        const bspB = new BSPNode(b.polygons);
        const result = new CSG();
        result.polygons = [
            ...bspB.clipPolygons(a.polygons, true),
            ...bspA.clipPolygons(b.polygons, true)
        ];
        return result;
    }

    static subtract(a, b) {
        const bspA = new BSPNode(a.polygons);
        const bspB = new BSPNode(b.polygons);
        const aOutsideB = bspB.clipPolygons(a.polygons, true);

        bspB.invert();
        const bInsideA = bspA.clipPolygons(bspB.allPolygons(), false);

        bInsideA.forEach(polygon => {
            polygon.normal.multiplyScalar(-1);
            polygon.vertices.reverse();
        });

        bspB.invert();

        const result = new CSG();
        result.polygons = [...aOutsideB, ...bInsideA];
        return result;
    }

    static intersect(a, b) {
        const bspA = new BSPNode(a.polygons);
        const bspB = new BSPNode(b.polygons);
        const result = new CSG();
        result.polygons = bspB.clipPolygons(a.polygons, false);
        return result;
    }

    static xor(a, b) {
        const u = CSG.union(a, b);
        const i = CSG.intersect(a, b);
        return CSG.subtract(u, i);
    }
}

// 辅助：从 Group 提取 CSG
function csgFromGroup(group) {
    const meshes = [];
    group.traverse(child => {
        if (child.isMesh) meshes.push(child);
    });
    if (meshes.length === 0) return null;
    let csg = CSG.fromMesh(meshes[0]);
    for (let i = 1; i < meshes.length; i++) {
        csg = CSG.union(csg, CSG.fromMesh(meshes[i]));
    }
    return csg;
}

// 辅助：预处理模型用于 CSG（应用缩放、计算法线）
function prepareModelForCSG(model) {
    if (!model) return;
    model.traverse(child => {
        if (child.isMesh && child.geometry) {
            if (child.scale.x !== 1 || child.scale.y !== 1 || child.scale.z !== 1) {
                const scaleMat = new THREE.Matrix4().makeScale(child.scale.x, child.scale.y, child.scale.z);
                child.geometry.applyMatrix4(scaleMat);
                child.scale.set(1, 1, 1);
            }
            child.geometry.computeVertexNormals();
        }
    });
}

// ========== 布尔状态管理与拾取系统 ==========
const booleanState = {
    operation: 'union',
    outputMode: 'new_model',
    tolerance: 1e-6,
    mergeVertices: true,
    holeFilling: true,
    opCount: 0,
    history: [],
    previewEnabled: true,
    previewMesh: null,
    wireframeEnabled: false,
    transparentB: false
};

let boolTargetAModel = null;
let boolToolBModel = null;
let isPickingMode = false;
let pickModeTarget = ''; // 'A' or 'B'
let highlightedObject = null;
let originalToolMaterial = null;

function highlightObject(obj, color = 0x00ff00) {
    if (highlightedObject) unhighlightObject();
    highlightedObject = obj;
    if (!obj) return;
    if (obj.material) {
        if (Array.isArray(obj.material)) {
            obj.material.forEach(m => { m.emissive = new THREE.Color(color); m.emissiveIntensity = 0.5; });
        } else {
            obj.material.emissive = new THREE.Color(color);
            obj.material.emissiveIntensity = 0.5;
        }
    } else if (obj.isGroup) {
        obj.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.emissive = new THREE.Color(color);
                child.material.emissiveIntensity = 0.5;
            }
        });
    }
}

function unhighlightObject() {
    if (!highlightedObject) return;
    if (highlightedObject.material) {
        if (Array.isArray(highlightedObject.material)) {
            highlightedObject.material.forEach(m => { m.emissive = new THREE.Color(0); m.emissiveIntensity = 0; });
        } else {
            highlightedObject.material.emissive = new THREE.Color(0);
            highlightedObject.material.emissiveIntensity = 0;
        }
    } else if (highlightedObject.isGroup) {
        highlightedObject.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.emissive = new THREE.Color(0);
                child.material.emissiveIntensity = 0;
            }
        });
    }
    highlightedObject = null;
}

function enterPickMode(target) {
    isPickingMode = true;
    pickModeTarget = target;
    const indicator = document.getElementById('pick-mode-indicator');
    if (indicator) {
        indicator.style.display = 'block';
        document.getElementById('pick-target-hint').textContent = target === 'A' ? '目标A' : (target === 'B' ? '工具B' : '堆栈目标');
    }
    renderer.domElement.style.cursor = 'crosshair';
}

function exitPickMode() {
    isPickingMode = false;
    pickModeTarget = '';
    const indicator = document.getElementById('pick-mode-indicator');
    if (indicator) indicator.style.display = 'none';
    renderer.domElement.style.cursor = '';
    unhighlightObject();
}

function updateBoolPreview() {
    if (!booleanState.previewEnabled || !boolTargetAModel || !boolToolBModel) {
        if (booleanState.previewMesh) {
            scene.remove(booleanState.previewMesh);
            booleanState.previewMesh = null;
        }
        return;
    }

    const cloneA = boolTargetAModel.clone(true);
    const cloneB = boolToolBModel.clone(true);
    cloneA.updateMatrixWorld();
    cloneB.updateMatrixWorld();
    scene.add(cloneA);
    scene.add(cloneB);
    prepareModelForCSG(cloneA);
    prepareModelForCSG(cloneB);
    const csgA = csgFromGroup(cloneA);
    const csgB = csgFromGroup(cloneB);
    let resultCSG = null;
    if (csgA && csgB) {
        switch (booleanState.operation) {
            case 'union': resultCSG = CSG.union(csgA, csgB); break;
            case 'intersection': resultCSG = CSG.intersect(csgA, csgB); break;
            case 'difference': resultCSG = CSG.subtract(csgA, csgB); break;
            case 'sym_diff': resultCSG = CSG.xor(csgA, csgB); break;
        }
    }
    disposeClone(cloneA);
    disposeClone(cloneB);

    if (booleanState.previewMesh) {
        scene.remove(booleanState.previewMesh);
        booleanState.previewMesh = null;
    }
    if (resultCSG) {
        const previewColor = document.getElementById('bool-preview-color')?.value || '#ffaa00';
        const mat = new THREE.MeshStandardMaterial({ color: previewColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        booleanState.previewMesh = resultCSG.toMesh(mat);
        booleanState.previewMesh.position.copy(boolTargetAModel.position);
        scene.add(booleanState.previewMesh);
    }
}

function updateToolDisplayMode() {
    if (!boolToolBModel) return;
    if (booleanState.wireframeEnabled) {
        boolToolBModel.traverse(child => {
            if (child.isMesh && child.material) {
                if (!originalToolMaterial) originalToolMaterial = child.material;
                child.material = new THREE.MeshBasicMaterial({ wireframe: true, color: 0xff0000 });
            }
        });
    } else if (booleanState.transparentB) {
        boolToolBModel.traverse(child => {
            if (child.isMesh && child.material) {
                if (!originalToolMaterial) originalToolMaterial = child.material;
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.3;
            }
        });
    } else {
        if (originalToolMaterial) {
            boolToolBModel.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material = originalToolMaterial;
                }
            });
            originalToolMaterial = null;
        }
    }
}

function applyBooleanOperation() {
    if (!boolTargetAModel || !boolToolBModel) {
        showError('请先选择目标A和工具B');
        return false;
    }
    const cloneA = boolTargetAModel.clone(true);
    const cloneB = boolToolBModel.clone(true);
    cloneA.updateMatrixWorld();
    cloneB.updateMatrixWorld();
    scene.add(cloneA);
    scene.add(cloneB);
    prepareModelForCSG(cloneA);
    prepareModelForCSG(cloneB);
    const csgA = csgFromGroup(cloneA);
    const csgB = csgFromGroup(cloneB);
    let resultCSG = null;
    if (csgA && csgB) {
        switch (booleanState.operation) {
            case 'union': resultCSG = CSG.union(csgA, csgB); break;
            case 'intersection': resultCSG = CSG.intersect(csgA, csgB); break;
            case 'difference': resultCSG = CSG.subtract(csgA, csgB); break;
            case 'sym_diff': resultCSG = CSG.xor(csgA, csgB); break;
        }
    }
    disposeClone(cloneA);
    disposeClone(cloneB);
    if (!resultCSG) {
        showError('布尔运算失败，几何体可能无效');
        return false;
    }
    let material = new THREE.MeshStandardMaterial({ color: 0xff4444, side: THREE.DoubleSide });
    const inherit = document.querySelector('input[name="bool-material-inherit"]:checked')?.value || 'A';
    if (inherit === 'A' && boolTargetAModel.material) {
        material = Array.isArray(boolTargetAModel.material) ? boolTargetAModel.material[0].clone() : boolTargetAModel.material.clone();
    } else if (inherit === 'B' && boolToolBModel.material) {
        material = Array.isArray(boolToolBModel.material) ? boolToolBModel.material[0].clone() : boolToolBModel.material.clone();
    }
    const resultMesh = resultCSG.toMesh(material);
    resultMesh.name = 'BooleanResult_' + (booleanState.opCount + 1);
    resultMesh.userData.shape = 'boolean_result';
    resultMesh.position.copy(boolTargetAModel.position);
    scene.add(resultMesh);
    booleanState.opCount++;
    document.getElementById('bool-op-count').textContent = `操作: ${booleanState.opCount} 次`;
    if (booleanState.previewMesh) {
        scene.remove(booleanState.previewMesh);
        booleanState.previewMesh = null;
    }
    return true;
}

// ========== 修改器堆栈系统 ==========
class BooleanModifier {
    constructor(operation, toolObject, tolerance = 1e-6, mergeVerts = true) {
        this.operation = operation;
        this.toolObject = toolObject;
        this.tolerance = tolerance;
        this.mergeVertices = mergeVerts;
        this.enabled = true;
        this.resultMesh = null;
    }
}

const modifierStack = {
    targetObject: null,
    modifiers: [],
    autoRecalc: true,
    showPreview: true,
    selectedIndex: -1,
    previewMesh: null
};

function setStackTarget(obj) {
    modifierStack.targetObject = obj;
    document.getElementById('stack-target-name').textContent = obj ? (obj.userData.shape || obj.name || '未命名') : '无';
    recalcStack();
}

function addModifierToStack(operation, toolObject) {
    modifierStack.modifiers.push(new BooleanModifier(operation, toolObject));
    refreshModifierList();
    recalcStack();
}

function removeModifierAt(index) {
    if (index >= 0 && index < modifierStack.modifiers.length) {
        modifierStack.modifiers.splice(index, 1);
        refreshModifierList();
        recalcStack();
    }
}

function moveModifier(from, to) {
    if (from < 0 || from >= modifierStack.modifiers.length || to < 0 || to >= modifierStack.modifiers.length) return;
    const mod = modifierStack.modifiers.splice(from, 1)[0];
    modifierStack.modifiers.splice(to, 0, mod);
    refreshModifierList();
    recalcStack();
}

function recalcStack() {
    if (!modifierStack.targetObject) return;
    if (modifierStack.previewMesh) {
        scene.remove(modifierStack.previewMesh);
        modifierStack.previewMesh = null;
    }
    if (!modifierStack.showPreview) return;

    let currentMesh = modifierStack.targetObject.clone(true);
    currentMesh.updateMatrixWorld();
    scene.add(currentMesh);
    prepareModelForCSG(currentMesh);
    let currentCSG = csgFromGroup(currentMesh);
    disposeClone(currentMesh);

    for (const mod of modifierStack.modifiers) {
        if (!mod.enabled) continue;
        const toolClone = mod.toolObject.clone(true);
        toolClone.updateMatrixWorld();
        scene.add(toolClone);
        prepareModelForCSG(toolClone);
        const toolCSG = csgFromGroup(toolClone);
        disposeClone(toolClone);
        if (!currentCSG || !toolCSG) continue;
        switch (mod.operation) {
            case 'union': currentCSG = CSG.union(currentCSG, toolCSG); break;
            case 'intersection': currentCSG = CSG.intersect(currentCSG, toolCSG); break;
            case 'difference': currentCSG = CSG.subtract(currentCSG, toolCSG); break;
            case 'sym_diff': currentCSG = CSG.xor(currentCSG, toolCSG); break;
        }
    }

    if (currentCSG) {
        const mat = new THREE.MeshStandardMaterial({ color: 0xffff00, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        modifierStack.previewMesh = currentCSG.toMesh(mat);
        modifierStack.previewMesh.position.copy(modifierStack.targetObject.position);
        scene.add(modifierStack.previewMesh);
    }
}

function refreshModifierList() {
    const container = document.getElementById('modifier-list-container');
    if (!container) return;
    container.innerHTML = '';
    if (modifierStack.modifiers.length === 0) {
        container.innerHTML = '<p style="color:#666; text-align:center;">暂无修改器</p>';
        return;
    }
    modifierStack.modifiers.forEach((mod, idx) => {
        const div = document.createElement('div');
        div.className = `modifier-item ${idx === modifierStack.selectedIndex ? 'selected' : ''} ${mod.enabled ? '' : 'disabled'}`;
        div.innerHTML = `
            <div class="modifier-item-name">
                ${getOpName(mod.operation)} <span class="modifier-item-tool">${mod.toolObject.userData.shape || '对象'}</span>
            </div>
        `;
        div.addEventListener('click', () => {
            modifierStack.selectedIndex = idx;
            refreshModifierList();
            updateDependencyTree();
        });
        container.appendChild(div);
    });
}

function updateDependencyTree() {
    const treeDiv = document.getElementById('stack-dependency-tree');
    if (!treeDiv) return;
    if (modifierStack.selectedIndex >= 0 && modifierStack.selectedIndex < modifierStack.modifiers.length) {
        const mod = modifierStack.modifiers[modifierStack.selectedIndex];
        treeDiv.innerHTML = `目标: ${modifierStack.targetObject?.userData.shape || '无'}<br>修改器: ${getOpName(mod.operation)}<br>工具: ${mod.toolObject.userData.shape || '未知'}<br>状态: ${mod.enabled ? '启用' : '禁用'}`;
    } else {
        treeDiv.innerHTML = '选中修改器查看依赖关系';
    }
}

function disposeClone(model) {
    scene.remove(model);
    model.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}

function showError(msg) {
    const box = document.getElementById('bool-error-box') || document.getElementById('stack-error-box');
    if (box) {
        box.textContent = msg;
        box.classList.add('show');
    }
}
function hideError() {
    const box = document.getElementById('bool-error-box') || document.getElementById('stack-error-box');
    if (box) box.classList.remove('show');
}

function getOpName(op) {
    return { union: '合集', intersection: '交集', difference: '差集', sym_diff: '对称差' }[op] || op;
}
function getOpHint(op) {
    return {
        union: '合集：保留 A + B 整体，内部重合面移除',
        intersection: '交集：只保留 A ∩ B 重合部分，其余全部丢弃',
        difference: '差集：保留 A 被 B 挖孔后的剩余部分',
        sym_diff: '对称差：保留不重叠部分，重合区域被挖掉'
    }[op] || '';
}

// ========== 布尔面板事件绑定 ==========
function initBooleanPanelEvents() {
    if (document.getElementById('bool-op-grid')?.dataset.initialized) return;
    document.getElementById('bool-op-grid')?.setAttribute('data-initialized', 'true');

    document.querySelectorAll('#bool-op-grid .op-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#bool-op-grid .op-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            booleanState.operation = btn.dataset.op;
            document.getElementById('bool-result-hint').textContent = getOpHint(booleanState.operation);
            updateBoolPreview();
        });
    });

    document.getElementById('bool-pick-target-a').addEventListener('click', () => enterPickMode('A'));
    document.getElementById('bool-pick-tool-b').addEventListener('click', () => enterPickMode('B'));
    document.getElementById('bool-clear-target-a').addEventListener('click', () => {
        boolTargetAModel = null;
        document.getElementById('bool-target-a-status').textContent = '未选择';
        updateBoolPreview();
    });
    document.getElementById('bool-clear-tool-b').addEventListener('click', () => {
        boolToolBModel = null;
        document.getElementById('bool-tool-b-status').textContent = '未选择';
        updateBoolPreview();
    });

    document.getElementById('bool-preview-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        booleanState.previewEnabled = this.classList.contains('active');
        updateBoolPreview();
    });
    document.getElementById('bool-wireframe-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        booleanState.wireframeEnabled = this.classList.contains('active');
        if (booleanState.wireframeEnabled) booleanState.transparentB = false;
        updateToolDisplayMode();
    });
    document.getElementById('bool-transparent-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        booleanState.transparentB = this.classList.contains('active');
        if (booleanState.transparentB) booleanState.wireframeEnabled = false;
        updateToolDisplayMode();
    });
    document.getElementById('bool-preview-color').addEventListener('input', updateBoolPreview);

    document.getElementById('bool-tol-slider').addEventListener('input', function(e) {
        const v = Math.pow(10, parseInt(e.target.value));
        booleanState.tolerance = v;
        document.getElementById('bool-tol-val').textContent = v.toExponential(0);
    });
    document.getElementById('bool-merge-verts').addEventListener('change', function(e) {
        booleanState.mergeVertices = e.target.checked;
    });

    document.getElementById('bool-apply-btn').addEventListener('click', () => {
        if (applyBooleanOperation()) {
            document.getElementById('bool-status-text').textContent = getOpName(booleanState.operation) + ' 完成';
        }
    });

    document.getElementById('bool-add-to-stack-btn').addEventListener('click', () => {
        if (!boolTargetAModel || !boolToolBModel) {
            showError('请先选择目标A和工具B');
            return;
        }
        setStackTarget(boolTargetAModel);
        addModifierToStack(booleanState.operation, boolToolBModel);
        document.getElementById('bool-status-text').textContent = '已添加到修改器堆栈';
    });
}

// ========== 修改器堆栈面板事件绑定 ==========
function initModifierStackEvents() {
    if (document.getElementById('modifier-list-container')?.dataset.initialized) return;
    document.getElementById('modifier-list-container')?.setAttribute('data-initialized', 'true');

    document.getElementById('stack-set-target-btn').addEventListener('click', () => enterPickMode('stack'));
    document.getElementById('stack-clear-all-btn').addEventListener('click', () => {
        modifierStack.modifiers = [];
        refreshModifierList();
        recalcStack();
    });
    document.getElementById('stack-move-up').addEventListener('click', () => {
        if (modifierStack.selectedIndex > 0) {
            moveModifier(modifierStack.selectedIndex, modifierStack.selectedIndex - 1);
            modifierStack.selectedIndex--;
            refreshModifierList();
            updateDependencyTree();
        }
    });
    document.getElementById('stack-move-down').addEventListener('click', () => {
        if (modifierStack.selectedIndex < modifierStack.modifiers.length - 1) {
            moveModifier(modifierStack.selectedIndex, modifierStack.selectedIndex + 1);
            modifierStack.selectedIndex++;
            refreshModifierList();
            updateDependencyTree();
        }
    });
    document.getElementById('stack-toggle-modifier').addEventListener('click', () => {
        if (modifierStack.selectedIndex >= 0) {
            modifierStack.modifiers[modifierStack.selectedIndex].enabled = !modifierStack.modifiers[modifierStack.selectedIndex].enabled;
            refreshModifierList();
            recalcStack();
        }
    });
    document.getElementById('stack-delete-modifier').addEventListener('click', () => {
        if (modifierStack.selectedIndex >= 0) {
            removeModifierAt(modifierStack.selectedIndex);
        }
    });
    document.getElementById('stack-auto-recalc').addEventListener('change', function(e) {
        modifierStack.autoRecalc = e.target.checked;
    });
    document.getElementById('stack-show-preview').addEventListener('change', function(e) {
        modifierStack.showPreview = e.target.checked;
        recalcStack();
    });
    document.getElementById('stack-recalc-now').addEventListener('click', recalcStack);
}

// 全局点击拾取逻辑
renderer.domElement.addEventListener('click', (e) => {
    if (!isPickingMode) return;
    const intersects = getIntersections(e);
    if (intersects.length > 0) {
        const obj = intersects[0].object;
        let model = obj;
        while (model && !model.userData.shape) model = model.parent;
        if (model && model.userData.shape) {
            if (pickModeTarget === 'A') {
                boolTargetAModel = model;
                document.getElementById('bool-target-a-status').textContent = getShapeDisplayName(model.userData.shape);
                updateBoolPreview();
            } else if (pickModeTarget === 'B') {
                boolToolBModel = model;
                document.getElementById('bool-tool-b-status').textContent = getShapeDisplayName(model.userData.shape);
                updateBoolPreview();
            } else if (pickModeTarget === 'stack') {
                setStackTarget(model);
            }
            exitPickMode();
        }
    }
});

// ========== 视频纹理状态与UI ==========
let currentVideoMode = 'horizontal';
let horizontalVideos = [];
let verticalVideos = [];
let dualHorizontalVideo = null;
let dualVerticalVideo = null;
let dualHorizontalTexture = null;
let dualVerticalTexture = null;
let isDualMode = false;
let activeDualVideo = 'horizontal';
let gestureState = { startX:0, startY:0, lastSwipeTime:0, threshold:30, videoSwitched: false };
let planeScrollState = { active: false, startX: 0, startY: 0, startGroupX: 0, startGroupY: 0, lastX:0, lastY:0, velocityX:0, velocityY:0, lastTime:0, snapTimeout: null };
let wasPlaneScrolling = false;
let planeOrientation = 'front';

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let mouseDownPos = new THREE.Vector2();
let mouseDownTime = 0;
let interactiveVideoHit = false;

function getIntersections(event) {
    mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    return raycaster.intersectObjects(scene.children, true);
}
function isInteractiveVideoObject(obj) {
    if (!obj) return false;
    if (obj.userData && obj.userData.isVideoItem) return true;
    if (currentShape === 'plane' && currentVideoMode === 'dual' && isDualMode && obj === currentModel) return true;
    return false;
}
function toggleVideoPlayback(obj) {
    if (!obj) return;
    if (obj.userData && obj.userData.isVideoItem) {
        const idx = obj.userData.videoIndex;
        let video = null;
        if (currentVideoMode === 'horizontal' && horizontalVideos[idx]) video = horizontalVideos[idx].video;
        else if (currentVideoMode === 'vertical' && verticalVideos[idx]) video = verticalVideos[idx].video;
        if (video) {
            if (video.paused) { video.play().catch(() => {}); }
            else { video.pause(); }
            if (currentVideoMode === 'horizontal' && horizontalVideos[idx]) horizontalVideos[idx].manualPause = video.paused;
            else if (currentVideoMode === 'vertical' && verticalVideos[idx]) verticalVideos[idx].manualPause = video.paused;
        }
    } else if (currentShape === 'plane' && currentVideoMode === 'dual' && isDualMode) {
        const activeVideo = activeDualVideo === 'horizontal' ? dualHorizontalVideo : dualVerticalVideo;
        if (activeVideo) {
            if (activeVideo.paused) activeVideo.play().catch(() => {});
            else activeVideo.pause();
        }
    }
}
renderer.domElement.addEventListener('mousedown', (e) => {
    if (isPickingMode) return;
    const intersects = getIntersections(e);
    if (intersects.length > 0 && isInteractiveVideoObject(intersects[0].object)) {
        interactiveVideoHit = true;
        e.stopPropagation();
    } else { interactiveVideoHit = false; }
    mouseDownPos.set(e.clientX, e.clientY);
    mouseDownTime = Date.now();
}, true);
renderer.domElement.addEventListener('mouseup', (e) => {
    if (isPickingMode) return;
    if (interactiveVideoHit) {
        const dx = e.clientX - mouseDownPos.x, dy = e.clientY - mouseDownPos.y;
        const dist = Math.sqrt(dx*dx + dy*dy), dt = Date.now() - mouseDownTime;
        if (dist < 3 && dt < 300) {
            const intersects = getIntersections(e);
            if (intersects.length > 0 && isInteractiveVideoObject(intersects[0].object)) toggleVideoPlayback(intersects[0].object);
        }
        interactiveVideoHit = false;
        e.stopPropagation();
    }
}, true);

function createHorizontalVideoWall(width, depth) {
    const group = new THREE.Group();
    const spacing = 1;
    const fullStep = width + spacing;
    group.userData.spacing = fullStep;
    horizontalVideos.forEach((item, i) => {
        const tex = item.texture;
        const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
        const geo = new THREE.PlaneGeometry(width, depth);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = i * fullStep;
        mesh.userData.videoIndex = i;
        mesh.userData.isVideoItem = true;
        group.add(mesh);
        item.mesh = mesh;
    });
    return group;
}
function createVerticalVideoWall(width, depth) {
    const group = new THREE.Group();
    const spacing = 1;
    const fullStep = depth + spacing;
    group.userData.spacing = fullStep;
    verticalVideos.forEach((item, i) => {
        const tex = item.texture;
        const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide });
        const geo = new THREE.PlaneGeometry(width, depth);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = i * -fullStep;
        mesh.userData.videoIndex = i;
        mesh.userData.isVideoItem = true;
        group.add(mesh);
        item.mesh = mesh;
    });
    return group;
}

function syncPlaneRotation() {
    if (currentShape !== 'plane' || !currentModel) return;
    const isVideoWall = (currentVideoMode === 'horizontal' && horizontalVideos.length > 0) ||
                        (currentVideoMode === 'vertical' && verticalVideos.length > 0) ||
                        (currentVideoMode === 'dual' && isDualMode);
    if (isVideoWall) {
        currentModel.rotation.set(0, 0, 0);
    } else {
        if (planeOrientation === 'front') {
            currentModel.rotation.set(0, 0, 0);
        } else if (planeOrientation === 'up') {
            currentModel.rotation.set(0, 0, 0);
        } else if (planeOrientation === 'left') {
            currentModel.rotation.set(0, -Math.PI / 2, 0);
        }
    }
}
function resetPlanePosition() {
    if (currentShape !== 'plane' || !currentModel) return;
    const coords = INITIAL_MODEL_COORDS['plane'];
    currentModel.position.set(coords.x, coords.y, coords.z);
    controls.target.copy(currentModel.position);
    syncCameraFromOffset();
}
function snapToNearestVideo() {
    if (!currentModel) return;
    const spacing = currentModel.userData?.spacing;
    if (!spacing) return;
    const initPos = initialModelPositions['plane'];
    if (!initPos) return;
    if (currentVideoMode === 'horizontal' && horizontalVideos.length) {
        const count = horizontalVideos.length;
        const offset = currentModel.position.x - initPos.x;
        let targetIndex = Math.round(-offset / spacing);
        targetIndex = Math.max(0, Math.min(targetIndex, count - 1));
        const targetX = initPos.x - targetIndex * spacing;
        smoothSnapTo(targetX, currentModel.position.y);
    } else if (currentVideoMode === 'vertical' && verticalVideos.length) {
        const count = verticalVideos.length;
        const offset = currentModel.position.y - initPos.y;
        let targetIndex = Math.round(offset / spacing);
        targetIndex = Math.max(0, Math.min(targetIndex, count - 1));
        const targetY = initPos.y + targetIndex * spacing;
        smoothSnapTo(currentModel.position.x, targetY);
    }
}
function smoothSnapTo(targetX, targetY) {
    const duration = 300;
    const startTime = Date.now();
    const startX = currentModel.position.x;
    const startY = currentModel.position.y;
    function animateSnap() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        currentModel.position.x = startX + (targetX - startX) * easeProgress;
        currentModel.position.y = startY + (targetY - startY) * easeProgress;
        if (progress < 1) requestAnimationFrame(animateSnap);
    }
    animateSnap();
}
function isMeshVisible(mesh) {
    if (!mesh || !mesh.geometry) return false;
    _box.setFromObject(mesh);
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    return _frustum.intersectsBox(_box);
}
function updateVideoVisibility() {
    if (currentShape !== 'plane' || !currentModel) return;
    if (currentVideoMode === 'dual') return;
    const videos = currentVideoMode === 'horizontal' ? horizontalVideos : verticalVideos;
    if (!videos || !videos.length) return;
    videos.forEach(item => {
        const video = item.video;
        const mesh = item.mesh;
        if (!video || !mesh) return;
        const visible = isMeshVisible(mesh);
        const manualPause = item.manualPause;
        if (visible) {
            if (!manualPause && video.paused) {
                video.play().catch(() => {});
            }
        } else {
            if (!video.paused) {
                video.pause();
            }
        }
    });
}
function setupGestureControls() {
    renderer.domElement.addEventListener('touchstart', (e) => {
        if (isPickingMode) return;
        if (currentShape !== 'plane' || !currentModel) return;
        const touches = e.touches;
        if (touches.length === 2) {
            e.preventDefault();
            if (currentVideoMode !== 'dual') return;
            gestureState.startX = (touches[0].clientX + touches[1].clientX) / 2;
            gestureState.startY = (touches[0].clientY + touches[1].clientY) / 2;
            gestureState.videoSwitched = false;
        }
        else if (touches.length === 1) {
            if (currentVideoMode !== 'horizontal' && currentVideoMode !== 'vertical') return;
            const hasVideos = (currentVideoMode === 'horizontal' && horizontalVideos.length > 0) ||
                              (currentVideoMode === 'vertical' && verticalVideos.length > 0);
            if (!hasVideos) return;
            e.preventDefault();
            clearTimeout(planeScrollState.snapTimeout);
            planeScrollState.active = true;
            planeScrollState.startX = touches[0].clientX;
            planeScrollState.startY = touches[0].clientY;
            planeScrollState.startGroupX = currentModel.position.x;
            planeScrollState.startGroupY = currentModel.position.y;
            planeScrollState.lastX = touches[0].clientX;
            planeScrollState.lastY = touches[0].clientY;
            planeScrollState.velocityX = 0;
            planeScrollState.velocityY = 0;
            planeScrollState.lastTime = Date.now();
            wasPlaneScrolling = false;
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchmove', (e) => {
        if (isPickingMode) return;
        if (currentShape !== 'plane' || !currentModel) return;
        const touches = e.touches;
        if (planeScrollState.active && touches.length === 1) {
            e.preventDefault();
            const dx = touches[0].clientX - planeScrollState.startX;
            const dy = touches[0].clientY - planeScrollState.startY;
            const currentTime = Date.now();
            const dt = currentTime - planeScrollState.lastTime;
            if (dt > 0) {
                const vx = (touches[0].clientX - planeScrollState.lastX) / dt;
                const vy = (touches[0].clientY - planeScrollState.lastY) / dt;
                planeScrollState.velocityX = vx * 15;
                planeScrollState.velocityY = vy * 15;
                planeScrollState.lastX = touches[0].clientX;
                planeScrollState.lastY = touches[0].clientY;
                planeScrollState.lastTime = currentTime;
            }
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasPlaneScrolling = true;
            if (currentVideoMode === 'horizontal') {
                currentModel.position.x = planeScrollState.startGroupX + dx * 0.02;
            } else if (currentVideoMode === 'vertical') {
                currentModel.position.y = planeScrollState.startGroupY - dy * 0.02;
            }
        }
        else if (touches.length === 2 && currentVideoMode === 'dual') {
            e.preventDefault();
            const t1 = touches[0], t2 = touches[1];
            const cx = (t1.clientX + t2.clientX) / 2, cy = (t1.clientY + t2.clientY) / 2;
            const dx = cx - gestureState.startX, dy = cy - gestureState.startY;
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > gestureState.threshold) {
                if (dualHorizontalVideo) {
                    if (activeDualVideo !== 'horizontal') {
                        activeDualVideo = 'horizontal';
                        if (currentModel.isMesh) {
                            currentModel.material.map = dualHorizontalTexture;
                            currentModel.material.needsUpdate = true;
                        } else if (currentModel.isGroup) {
                            currentModel.children.forEach(c => { if (c.isMesh) { c.material.map = dualHorizontalTexture; c.material.needsUpdate = true; } });
                        }
                        updateDualPlayButtons();
                    }
                    const duration = dualHorizontalVideo.duration || 1;
                    const seek = (dx / window.innerWidth) * duration * 0.5;
                    let newTime = dualHorizontalVideo.currentTime + seek;
                    newTime = ((newTime % duration) + duration) % duration;
                    dualHorizontalVideo.currentTime = newTime;
                    if (dualHorizontalVideo.paused && dualHorizontalTexture) {
                        dualHorizontalTexture.needsUpdate = true;
                    }
                    gestureState.startX = cx; gestureState.startY = cy;
                }
            } 
            else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > gestureState.threshold) {
                if (dualVerticalVideo) {
                    if (activeDualVideo !== 'vertical') {
                        activeDualVideo = 'vertical';
                        if (currentModel.isMesh) {
                            currentModel.material.map = dualVerticalTexture;
                            currentModel.material.needsUpdate = true;
                        } else if (currentModel.isGroup) {
                            currentModel.children.forEach(c => { if (c.isMesh) { c.material.map = dualVerticalTexture; c.material.needsUpdate = true; } });
                        }
                        updateDualPlayButtons();
                    }
                    const duration = dualVerticalVideo.duration || 1;
                    const seek = (dy / window.innerHeight) * duration * 0.75;
                    let newTime = dualVerticalVideo.currentTime + seek;
                    newTime = ((newTime % duration) + duration) % duration;
                    dualVerticalVideo.currentTime = newTime;
                    if (dualVerticalVideo.paused && dualVerticalTexture) {
                        dualVerticalTexture.needsUpdate = true;
                    }
                    gestureState.startX = cx; gestureState.startY = cy;
                }
            }
        }
    }, { passive: false });

    renderer.domElement.addEventListener('touchend', (e) => {
        if (planeScrollState.active) {
            const touch = e.changedTouches[0];
            const dx = touch ? (touch.clientX - planeScrollState.startX) : 0;
            const dy = touch ? (touch.clientY - planeScrollState.startY) : 0;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const dt = Date.now() - planeScrollState.lastTime;
            if (dist < 8 && dt < 500) {
                if (touch) {
                    mouse.x = (touch.clientX / renderer.domElement.clientWidth) * 2 - 1;
                    mouse.y = -(touch.clientY / renderer.domElement.clientHeight) * 2 + 1;
                    raycaster.setFromCamera(mouse, camera);
                    const intersects = raycaster.intersectObjects(scene.children, true);
                    if (intersects.length > 0 && isInteractiveVideoObject(intersects[0].object)) {
                        toggleVideoPlayback(intersects[0].object);
                    }
                }
            } else {
                startInertiaAnimation();
            }
            clearTimeout(planeScrollState.snapTimeout);
            planeScrollState.snapTimeout = setTimeout(() => {
                if (!planeScrollState.active && !isAnimating) {
                    snapToNearestVideo();
                }
            }, 150);
            planeScrollState.active = false;
            wasPlaneScrolling = false;
        }
        gestureState.videoSwitched = false;
    });
}
let inertiaAnimationId = null;
let isAnimating = false;
function startInertiaAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    const friction = 0.95;
    const stopThreshold = 0.001;
    function animate() {
        if (!planeScrollState.active && currentModel) {
            if (Math.abs(planeScrollState.velocityX) > stopThreshold || Math.abs(planeScrollState.velocityY) > stopThreshold) {
                if (currentVideoMode === 'horizontal') currentModel.position.x += planeScrollState.velocityX;
                else if (currentVideoMode === 'vertical') currentModel.position.y -= planeScrollState.velocityY;
                planeScrollState.velocityX *= friction;
                planeScrollState.velocityY *= friction;
                inertiaAnimationId = requestAnimationFrame(animate);
            } else {
                snapToNearestVideo();
                isAnimating = false;
            }
        } else {
            isAnimating = false;
        }
    }
    animate();
}

// ========== 视频纹理 UI 初始化 ==========
function initVideoTextureControls() {
    const tabs = document.querySelectorAll('.video-tab');
    const contents = {
        horizontal: document.getElementById('video-tab-horizontal'),
        vertical: document.getElementById('video-tab-vertical'),
        dual: document.getElementById('video-tab-dual')
    };
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const mode = tab.dataset.mode;
            currentVideoMode = mode;
            for (const [key, el] of Object.entries(contents)) {
                el.style.display = (key === mode) ? 'block' : 'none';
            }
            if (currentShape === 'plane') {
                updateModel('plane');
            }
        });
    });

    document.getElementById('upload-horizontal-video').addEventListener('click', () => document.getElementById('hidden-video-horizontal-input').click());
    document.getElementById('hidden-video-horizontal-input').addEventListener('change', function(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        horizontalVideos.forEach(item => { item.video.pause(); URL.revokeObjectURL(item.video.src); item.texture.dispose(); });
        horizontalVideos = [];
        const autoPlay = document.getElementById('auto-play-horizontal').classList.contains('active');
        const loop = document.getElementById('loop-horizontal').classList.contains('active');
        files.forEach(file => {
            const v = document.createElement('video'); v.src = URL.createObjectURL(file); v.loop = loop; v.muted = true; v.playsInline = true; v.autoplay = autoPlay;
            if (autoPlay) v.play().catch(() => {});
            const tex = new THREE.VideoTexture(v); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
            horizontalVideos.push({ video: v, texture: tex, manualPause: false });
        });
        if (currentShape === 'plane' && currentVideoMode === 'horizontal') {
            updateModel('plane');
        }
        e.target.value = '';
    });
    document.getElementById('delete-horizontal-video').addEventListener('click', () => {
        horizontalVideos.forEach(item => { item.video.pause(); URL.revokeObjectURL(item.video.src); item.texture.dispose(); });
        horizontalVideos = [];
        if (currentShape === 'plane' && currentVideoMode === 'horizontal') {
            updateModel('plane');
        }
    });
    document.getElementById('auto-play-horizontal').addEventListener('click', function() {
        this.classList.toggle('active');
        const active = this.classList.contains('active');
        horizontalVideos.forEach(item => { item.video.autoplay = active; if (active) item.video.play().catch(() => {}); else item.video.pause(); });
    });
    document.getElementById('loop-horizontal').addEventListener('click', function() { this.classList.toggle('active'); horizontalVideos.forEach(item => item.video.loop = this.classList.contains('active')); });

    document.getElementById('upload-vertical-video').addEventListener('click', () => document.getElementById('hidden-video-vertical-input').click());
    document.getElementById('hidden-video-vertical-input').addEventListener('change', function(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        verticalVideos.forEach(item => { item.video.pause(); URL.revokeObjectURL(item.video.src); item.texture.dispose(); });
        verticalVideos = [];
        const autoPlay = document.getElementById('auto-play-vertical').classList.contains('active');
        const loop = document.getElementById('loop-vertical').classList.contains('active');
        files.forEach(file => {
            const v = document.createElement('video'); v.src = URL.createObjectURL(file); v.loop = loop; v.muted = true; v.playsInline = true; v.autoplay = autoPlay;
            if (autoPlay) v.play().catch(() => {});
            const tex = new THREE.VideoTexture(v); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
            verticalVideos.push({ video: v, texture: tex, manualPause: false });
        });
        if (currentShape === 'plane' && currentVideoMode === 'vertical') {
            updateModel('plane');
        }
        e.target.value = '';
    });
    document.getElementById('delete-vertical-video').addEventListener('click', () => {
        verticalVideos.forEach(item => { item.video.pause(); URL.revokeObjectURL(item.video.src); item.texture.dispose(); });
        verticalVideos = [];
        if (currentShape === 'plane' && currentVideoMode === 'vertical') {
            updateModel('plane');
        }
    });
    document.getElementById('auto-play-vertical').addEventListener('click', function() {
        this.classList.toggle('active');
        const active = this.classList.contains('active');
        verticalVideos.forEach(item => { item.video.autoplay = active; if (active) item.video.play().catch(() => {}); else item.video.pause(); });
    });
    document.getElementById('loop-vertical').addEventListener('click', function() { this.classList.toggle('active'); verticalVideos.forEach(item => item.video.loop = this.classList.contains('active')); });

    const dualUploadH = document.getElementById('upload-dual-horizontal');
    dualUploadH.textContent = '↔️';
    dualUploadH.addEventListener('click', () => document.getElementById('hidden-video-dual-horizontal-input').click());
    document.getElementById('hidden-video-dual-horizontal-input').addEventListener('change', function(e) {
        const file = e.target.files[0]; if (!file) return;
        if (dualHorizontalVideo) { dualHorizontalVideo.pause(); URL.revokeObjectURL(dualHorizontalVideo.src); dualHorizontalTexture.dispose(); }
        const v = document.createElement('video');
        v.src = URL.createObjectURL(file);
        v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = false; v.preload = 'auto';
        const onReady = () => {
            v.currentTime = 0.1;
            v.pause();
            v.removeEventListener('loadedmetadata', onReady);
            v.removeEventListener('canplay', onReady);
            if (dualHorizontalTexture) dualHorizontalTexture.dispose();
            dualHorizontalTexture = new THREE.VideoTexture(v);
            dualHorizontalTexture.minFilter = THREE.LinearFilter; dualHorizontalTexture.magFilter = THREE.LinearFilter;
            dualHorizontalVideo = v;
            activeDualVideo = 'horizontal';
            updateDualModeState();
            if (currentShape === 'plane' && currentVideoMode === 'dual') {
                updateModel('plane');
            }
            updateDualPlayButtons();
        };
        v.addEventListener('loadedmetadata', onReady);
        v.addEventListener('canplay', onReady);
        v.load();
        e.target.value = '';
    });

    const dualUploadV = document.getElementById('upload-dual-vertical');
    dualUploadV.textContent = '↕️';
    dualUploadV.addEventListener('click', () => document.getElementById('hidden-video-dual-vertical-input').click());
    document.getElementById('hidden-video-dual-vertical-input').addEventListener('change', function(e) {
        const file = e.target.files[0]; if (!file) return;
        if (dualVerticalVideo) { dualVerticalVideo.pause(); URL.revokeObjectURL(dualVerticalVideo.src); dualVerticalTexture.dispose(); }
        const v = document.createElement('video');
        v.src = URL.createObjectURL(file);
        v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = false; v.preload = 'auto';
        const onReady = () => {
            v.currentTime = 0.1;
            v.pause();
            v.removeEventListener('loadedmetadata', onReady);
            v.removeEventListener('canplay', onReady);
            if (dualVerticalTexture) dualVerticalTexture.dispose();
            dualVerticalTexture = new THREE.VideoTexture(v);
            dualVerticalTexture.minFilter = THREE.LinearFilter; dualVerticalTexture.magFilter = THREE.LinearFilter;
            dualVerticalVideo = v;
            updateDualModeState();
            if (currentShape === 'plane' && currentVideoMode === 'dual') {
                updateModel('plane');
            }
            updateDualPlayButtons();
        };
        v.addEventListener('loadedmetadata', onReady);
        v.addEventListener('canplay', onReady);
        v.load();
        e.target.value = '';
    });

    // 双向视频播放控制按钮
    const oldPlayBtn = document.getElementById('dual-play-pause');
    if (oldPlayBtn && oldPlayBtn.parentNode) {
        const parent = oldPlayBtn.parentNode;
        const hBtn = document.createElement('button');
        hBtn.id = 'dual-play-horizontal';
        hBtn.className = 'texture-btn-sm video-play-btn';
        hBtn.textContent = '横滑▶️';
        parent.insertBefore(hBtn, oldPlayBtn);
        const vBtn = document.createElement('button');
        vBtn.id = 'dual-play-vertical';
        vBtn.className = 'texture-btn-sm video-play-btn';
        vBtn.textContent = '竖滑▶️';
        parent.insertBefore(vBtn, oldPlayBtn);
        parent.removeChild(oldPlayBtn);
        hBtn.addEventListener('click', () => {
            if (!dualHorizontalVideo) return;
            if (dualHorizontalVideo.paused) {
                dualHorizontalVideo.play().catch(() => {});
                hBtn.textContent = '横滑⏸️';
            } else {
                dualHorizontalVideo.pause();
                hBtn.textContent = '横滑▶️';
            }
            activeDualVideo = 'horizontal';
            if (currentShape === 'plane' && currentVideoMode === 'dual' && isDualMode) {
                if (currentModel.isMesh) {
                    currentModel.material.map = dualHorizontalTexture;
                    currentModel.material.needsUpdate = true;
                } else if (currentModel.isGroup) {
                    currentModel.children.forEach(c => { if (c.isMesh) { c.material.map = dualHorizontalTexture; c.material.needsUpdate = true; } });
                }
            }
        });
        vBtn.addEventListener('click', () => {
            if (!dualVerticalVideo) return;
            if (dualVerticalVideo.paused) {
                dualVerticalVideo.play().catch(() => {});
                vBtn.textContent = '竖滑⏸️';
            } else {
                dualVerticalVideo.pause();
                vBtn.textContent = '竖滑▶️';
            }
            activeDualVideo = 'vertical';
            if (currentShape === 'plane' && currentVideoMode === 'dual' && isDualMode) {
                if (currentModel.isMesh) {
                    currentModel.material.map = dualVerticalTexture;
                    currentModel.material.needsUpdate = true;
                } else if (currentModel.isGroup) {
                    currentModel.children.forEach(c => { if (c.isMesh) { c.material.map = dualVerticalTexture; c.material.needsUpdate = true; } });
                }
            }
        });
    }

    document.getElementById('delete-dual-videos').addEventListener('click', () => {
        if (dualHorizontalVideo) { dualHorizontalVideo.pause(); URL.revokeObjectURL(dualHorizontalVideo.src); dualHorizontalTexture.dispose(); dualHorizontalVideo = null; dualHorizontalTexture = null; }
        if (dualVerticalVideo) { dualVerticalVideo.pause(); URL.revokeObjectURL(dualVerticalVideo.src); dualVerticalTexture.dispose(); dualVerticalVideo = null; dualVerticalTexture = null; }
        isDualMode = false;
        if (currentShape === 'plane' && currentVideoMode === 'dual') {
            updateModel('plane');
        }
        const hBtn = document.getElementById('dual-play-horizontal');
        if (hBtn) hBtn.textContent = '横滑▶️';
        const vBtn = document.getElementById('dual-play-vertical');
        if (vBtn) vBtn.textContent = '竖滑▶️';
    });

    document.querySelector('.video-tab[data-mode="horizontal"]').click();
}

function updateDualPlayButtons() {
    const hBtn = document.getElementById('dual-play-horizontal');
    if (hBtn && dualHorizontalVideo) {
        hBtn.textContent = dualHorizontalVideo.paused ? '横滑▶️' : '横滑⏸️';
    } else if (hBtn) {
        hBtn.textContent = '横滑▶️';
    }
    const vBtn = document.getElementById('dual-play-vertical');
    if (vBtn && dualVerticalVideo) {
        vBtn.textContent = dualVerticalVideo.paused ? '竖滑▶️' : '竖滑⏸️';
    } else if (vBtn) {
        vBtn.textContent = '竖滑▶️';
    }
}
function updateDualModeState() {
    isDualMode = !!(dualHorizontalVideo || dualVerticalVideo);
}

// ========== 模型管理与切换 ==========
const modelsCache = {};
const modelsMeta = {};
let currentModel = null;
let currentShape = 'sphere';
const initialModelPositions = {};
let cameraOffset = { x:0, y:0, z:10 };
let pendingTextureFace = null;
const materialTextures = { diffuse:null, metalRough:null, normal:null, emissive:null };
let groundTexture = null, bgTexture = null;
const activeVideoElements = [];

function getDefaultMeta(){ return { autoRotate:{x:false,y:false,z:false}, rotateSpeed:{x:2.0,y:2.0,z:2.0}, rotateDir:{x:1,y:1,z:1} }; }
function getMetaForShape(shape){ if(!modelsMeta[shape]) modelsMeta[shape]=getDefaultMeta(); return modelsMeta[shape]; }
function saveCurrentMeta(){
    if(!currentShape) return;
    const m=getMetaForShape(currentShape);
    const prefix = currentShape + '-';
    ['x','y','z'].forEach(a=>{
        const tb = document.getElementById(`${prefix}toggle-${a}`);
        if(tb) m.autoRotate[a] = tb.classList.contains('active');
        const si = document.getElementById(`${prefix}speed-${a}`);
        if(si) m.rotateSpeed[a] = parseFloat(si.value) || 2;
        const db = document.getElementById(`${prefix}dir-${a}`);
        if(db) m.rotateDir[a] = (db.textContent === '反转') ? -1 : 1;
    });
}
function loadMetaToUI(shape){
    const m = getMetaForShape(shape);
    const prefix = shape + '-';
    ['x','y','z'].forEach(a => {
        const tb = document.getElementById(`${prefix}toggle-${a}`);
        const si = document.getElementById(`${prefix}speed-${a}`);
        const db = document.getElementById(`${prefix}dir-${a}`);
        const axisName = a.toUpperCase();
        if(tb){ tb.classList.toggle('active', m.autoRotate[a]); tb.textContent = m.autoRotate[a] ? `绕${axisName}轴旋转中` : `绕${axisName}轴旋转`; }
        if(si) si.value = m.rotateSpeed[a];
        if(db) db.textContent = m.rotateDir[a] === 1 ? '正转' : '反转';
    });
}
function createModelForShape(shape){
    switch(shape){
        case 'pipe':{
            const or=parseFloat(document.getElementById('outer-radius-slider')?.value)||0.7;
            const ir=Math.min(parseFloat(document.getElementById('inner-radius-slider')?.value)||0.6,or-0.01);
            const len=parseFloat(document.getElementById('pipe-length-slider')?.value)||2.0;
            return createPrecisePipeMesh(or,ir,len);
        }
        case 'square_tube':{
            const ow=parseFloat(document.getElementById('outer-width-slider')?.value)||1.2;
            const oh=parseFloat(document.getElementById('outer-height-slider')?.value)||1.2;
            const iw=Math.min(parseFloat(document.getElementById('inner-width-slider')?.value)||0.8,ow-0.05);
            const ih=Math.min(parseFloat(document.getElementById('inner-height-slider')?.value)||0.8,oh-0.05);
            const slen=parseFloat(document.getElementById('square-length-slider')?.value)||2.0;
            return createExtrudeSquareTube(ow,oh,iw,ih,slen);
        }
        case 'sphere': return createBasicSphere();
        case 'cylinder': return createBasicCylinder();
        case 'cone': return createBasicCone();
        case 'frustum_cone': return createBasicFrustum();
        case 'torus': return createBasicTorus();
        case 'cube': return createBasicCube();
        case 'pyramid': return createBasicPyramid();
        case 'prism_frustum':{
            const tw=parseFloat(document.getElementById('top-width-slider')?.value)||1;
            const td=parseFloat(document.getElementById('top-depth-slider')?.value)||1;
            const bw=parseFloat(document.getElementById('bottom-width-slider')?.value)||1.5;
            const bd=parseFloat(document.getElementById('bottom-depth-slider')?.value)||1.5;
            const ph=parseFloat(document.getElementById('prism-height-slider')?.value)||1.5;
            return createPrismFrustumWithParams(tw,td,bw,bd,ph);
        }
        case 'plane': return createPlaneModel();
        default: return createBasicSphere();
    }
}

function replaceCurrentModel(newModel){
    if(currentModel){
        const op=currentModel.position.clone(), or=currentModel.rotation.clone(), os=currentModel.scale.clone();
        scene.remove(currentModel);
        if(currentModel.isGroup) {
            currentModel.children.forEach(c=>{
                if(c.geometry) c.geometry.dispose();
                if(c.material){
                    if(Array.isArray(c.material)) c.material.forEach(m=>m.dispose());
                    else c.material.dispose();
                }
            });
        } else {
            if(currentModel.geometry) currentModel.geometry.dispose();
            if(currentModel.material){
                if(Array.isArray(currentModel.material)) currentModel.material.forEach(m=>m.dispose());
                else currentModel.material.dispose();
            }
        }
        currentModel=newModel;
        currentModel.position.copy(op);
        currentModel.rotation.copy(or);
        currentModel.scale.copy(os);
        scene.add(currentModel);
    } else {
        currentModel=newModel;
        scene.add(currentModel);
    }
    if(!initialModelPositions[currentShape]) initialModelPositions[currentShape]=currentModel.position.clone();
    modelsCache[currentShape]=currentModel;
    setTimeout(()=>{
        if(currentModel){
            controls.target.copy(currentModel.position);
            controls.update();
        }
    },30);
}
function updateModel(shapeKey){
    if(currentShape!==shapeKey) return;
    replaceCurrentModel(createModelForShape(shapeKey));
    if (currentShape === 'plane') syncPlaneRotation();
}
function switchToShape(shape){
    if(shape===currentShape) return;
    saveCurrentMeta();
    if(currentModel) modelsCache[currentShape]=currentModel;
    currentShape=shape;
    let model=modelsCache[shape];
    if(!model){
        model=createModelForShape(shape);
        modelsCache[shape]=model;
        const co=INITIAL_MODEL_COORDS[shape]||{x:0,y:0,z:0};
        model.position.set(co.x,co.y,co.z);
        scene.add(model);
    }
    currentModel=model;
    controls.target.copy(currentModel.position);
    if(!initialModelPositions[shape]) initialModelPositions[shape]=currentModel.position.clone();
    const px = document.getElementById(`pos-x-${shape}`), py = document.getElementById(`pos-y-${shape}`), pz = document.getElementById(`pos-z-${shape}`);
    if(px&&py&&pz){
        px.value = currentModel.position.x;
        py.value = currentModel.position.y;
        pz.value = currentModel.position.z;
    }
    syncCameraFromOffset();
    loadMetaToUI(shape);
    setTimeout(()=>{
        if(currentModel){
            controls.target.copy(currentModel.position);
            controls.update();
        }
    },30);
    if(document.getElementById('texture-settings-panel').classList.contains('visible')) updateTexturePanelContent();
    refreshMaterialPanel();
    if (currentShape === 'plane') syncPlaneRotation();
    if (window.syncInteractionButtons) syncInteractionButtons();
}
function getShapePanelId(shape){
    if (shape === 'frustum_cone') return 'frustum';
    if (shape === 'prism_frustum') return 'prism-frustum';
    if (shape === 'square_tube') return 'square-tube';
    return shape;
}
function syncCameraFromOffset(){
    if(!currentModel) return;
    const t=currentModel.position;
    controls.target.copy(t);
    camera.position.set(t.x+cameraOffset.x, t.y+cameraOffset.y, t.z+cameraOffset.z);
    controls.update();
}

// ========== 纹理面板UI ==========
const texturePanel=document.getElementById('texture-settings-panel'),
      texturePanelContent=document.getElementById('texture-panel-content'),
      hiddenFileInput=document.getElementById('hidden-texture-file-input');
function getShapeDisplayName(s){
    const m={sphere:'球体',cylinder:'圆柱',cone:'圆锥',frustum_cone:'圆台',torus:'圆环',pipe:'圆管',cube:'方体',square_tube:'方管',pyramid:'棱锥',prism_frustum:'棱台',plane:'平面',boolean_result:'布尔结果'};
    return m[s]||s;
}
function updateTexturePanelContent(){
    const shape = currentShape;
    const videoSection = document.getElementById('video-texture-section');
    const contentArea = document.getElementById('texture-panel-content');
    if (shape === 'plane') {
        if (contentArea) contentArea.style.display = 'none';
        if (videoSection) videoSection.style.display = 'block';
    } else {
        if (contentArea) contentArea.style.display = 'flex';
        if (videoSection) videoSection.style.display = 'none';
        const def = shapeFacesDef[shape];
        if (!def) { texturePanelContent.innerHTML = '<div style="text-align:center;padding:20px;">暂无纹理设置</div>'; return; }
        const dn = getShapeDisplayName(shape);
        let html = `<div class="texture-shape-title">🟢 ${dn}</div>`;
        if (def.outer && def.outer.length) {
            html += '<div class="texture-section-label">外表面</div><div class="texture-faces-grid">';
            def.outer.forEach(face => {
                const tex = getTextureForFace(shape, face); const has = !!tex; const isVideo = has && tex.isVideoTexture;
                const paused = isVideo ? tex.image.paused : false; const playBtnText = isVideo ? (paused ? '▶️' : '⏸️') : '';
                html += `<div class="texture-face-item${has ? ' has-texture' : ''}" data-face="${face}"><span class="texture-face-dot${has ? ' loaded' : ''}"></span><span class="texture-face-name">${face}</span><button class="texture-btn-sm upload-face-btn" data-face="${face}">⬆️</button>${isVideo ? `<button class="texture-btn-sm video-play-btn" data-face="${face}">${playBtnText}</button>` : ''}<button class="texture-btn-sm delete-btn delete-face-btn" data-face="${face}">🗑️</button></div>`;
            });
            html += '</div>';
        }
        if (def.inner && def.inner.length) {
            html += '<div class="texture-section-label">内表面</div><div class="texture-faces-grid">';
            def.inner.forEach(face => {
                const tex = getTextureForFace(shape, face); const has = !!tex; const isVideo = has && tex.isVideoTexture;
                const paused = isVideo ? tex.image.paused : false; const playBtnText = isVideo ? (paused ? '▶️' : '⏸️') : '';
                html += `<div class="texture-face-item${has ? ' has-texture' : ''}" data-face="${face}"><span class="texture-face-dot${has ? ' loaded' : ''}"></span><span class="texture-face-name">${face}</span><button class="texture-btn-sm upload-face-btn" data-face="${face}">⬆️</button>${isVideo ? `<button class="texture-btn-sm video-play-btn" data-face="${face}">${playBtnText}</button>` : ''}<button class="texture-btn-sm delete-btn delete-face-btn" data-face="${face}">🗑️</button></div>`;
            });
            html += '</div>';
        }
        html += '<div class="texture-bottom-actions"><button class="texture-action-btn" id="texture-upload-all-btn">⬆️ 上传所有面</button></div>';
        texturePanelContent.innerHTML = html;
        texturePanelContent.querySelectorAll('.upload-face-btn').forEach(b => { b.addEventListener('click', e => { e.stopPropagation(); pendingTextureFace = b.dataset.face; hiddenFileInput.click(); }); });
        texturePanelContent.querySelectorAll('.delete-face-btn').forEach(b => { b.addEventListener('click', e => { e.stopPropagation(); removeTextureForFace(currentShape, b.dataset.face); updateModel(currentShape); updateTexturePanelContent(); }); });
        document.getElementById('texture-upload-all-btn')?.addEventListener('click', e => { e.stopPropagation(); pendingTextureFace = 'all'; hiddenFileInput.click(); });
        texturePanelContent.querySelectorAll('.video-play-btn').forEach(b => { b.addEventListener('click', e => { e.stopPropagation(); const tex = getTextureForFace(currentShape, b.dataset.face); if (tex && tex.isVideoTexture) { const video = tex.image; if (video) { if (video.paused) video.play().catch(()=>{}); else video.pause(); updateTexturePanelContent(); } } }); });
    }
}
function createMediaTexture(file,cb){
    if(file.type.startsWith('video/')){
        const v=document.createElement('video'); v.src=URL.createObjectURL(file); v.crossOrigin='anonymous'; v.loop=true; v.muted=false; v.playsInline=true; v.autoplay=false; v.pause();
        const tex=new THREE.VideoTexture(v); tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter; tex.format=THREE.RGBAFormat;
        activeVideoElements.push(v); cb(tex);
    } else {
        const r=new FileReader(); r.onload=e=>{
            const img=new Image(); img.onload=()=>{
                const tex=new THREE.Texture(img); tex.needsUpdate=true; tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
                cb(tex);
            }; img.src=e.target.result;
        }; r.readAsDataURL(file);
    }
}
hiddenFileInput.addEventListener('change',()=>{
    const file=hiddenFileInput.files[0];
    if(!file||!pendingTextureFace){ hiddenFileInput.value=''; return; }
    createMediaTexture(file,tex=>{
        if(pendingTextureFace==='all') getAllFacesForShape(currentShape).forEach(f=>setTextureForFace(currentShape,f,tex.clone()));
        else setTextureForFace(currentShape,pendingTextureFace,tex);
        updateModel(currentShape); updateTexturePanelContent(); pendingTextureFace=null; hiddenFileInput.value='';
    });
});
document.getElementById('texture-panel-close-btn').addEventListener('click',()=>{
    texturePanel.classList.remove('visible');
    document.getElementById('texture-tool-btn')?.classList.remove('texture-active');
});

// ========== 相机面板 ==========
let cameraPanelBuilt = false;
function buildCameraPanel() {
    if (cameraPanelBuilt) return;
    const cont = document.getElementById('positioning-controls-container');
    if (!cont) return;
    cont.innerHTML = `
        <div class="control-group">
            <div class="control-title">相机偏移</div>
            <div class="control-row"><span class="control-label">X</span><input type="range" id="cam-offset-x-slider" min="-20" max="20" value="0" step="0.1"><input type="number" id="cam-offset-x-input" class="coord-input" value="0" step="0.1"></div>
            <div class="control-row"><span class="control-label">Y</span><input type="range" id="cam-offset-y-slider" min="-20" max="20" value="0" step="0.1"><input type="number" id="cam-offset-y-input" class="coord-input" value="0" step="0.1"></div>
            <div class="control-row"><span class="control-label">Z</span><input type="range" id="cam-offset-z-slider" min="-20" max="20" value="10" step="0.1"><input type="number" id="cam-offset-z-input" class="coord-input" value="10" step="0.1"></div>
        </div>
        <div class="control-group">
            <div class="control-title">投影设置</div>
            <div style="display:flex;gap:8px;margin-bottom:10px;"><button class="proj-mode-btn active" id="mode-persp">透视</button><button class="proj-mode-btn" id="mode-ortho">正交</button></div>
            <div id="persp-controls"><div class="control-row"><span class="control-label">FOV</span><input type="range" id="fov-slider" min="1" max="179" value="42" step="1"><input type="number" id="fov-input" class="coord-input" value="42" step="1"></div></div>
            <div id="ortho-controls" style="display:none;"><div class="control-row"><span class="control-label">缩放</span><input type="range" id="ortho-size-slider" min="0.1" max="100" value="5" step="0.1"><input type="number" id="ortho-size-input" class="coord-input" value="5" step="0.1"></div></div>
            <div class="control-row"><span class="control-label">近裁剪面</span><input type="number" id="near-clip" class="coord-input" value="0.1" step="0.01"></div>
            <div class="control-row"><span class="control-label">远裁剪面</span><input type="number" id="far-clip" class="coord-input" value="1000" step="10"></div>
        </div>
    `;
    const bindOff = (sid, iid, ax) => {
        const s = document.getElementById(sid), i = document.getElementById(iid);
        if (!s || !i) return;
        const updateFromSlider = () => { const v = parseFloat(s.value); i.value = v.toFixed(1); cameraOffset[ax] = v; syncCameraFromOffset(); };
        const updateFromInput = () => { let v = parseFloat(i.value); if (isNaN(v)) return; v = Math.min(20, Math.max(-20, v)); s.value = v; cameraOffset[ax] = v; syncCameraFromOffset(); };
        s.addEventListener('input', updateFromSlider);
        i.addEventListener('change', updateFromInput);
        s.value = cameraOffset[ax]; i.value = cameraOffset[ax].toFixed(1);
    };
    bindOff('cam-offset-x-slider', 'cam-offset-x-input', 'x');
    bindOff('cam-offset-y-slider', 'cam-offset-y-input', 'y');
    bindOff('cam-offset-z-slider', 'cam-offset-z-input', 'z');
    const mp = document.getElementById('mode-persp'), mo = document.getElementById('mode-ortho'),
          pc = document.getElementById('persp-controls'), oc = document.getElementById('ortho-controls'),
          fs = document.getElementById('fov-slider'), fi = document.getElementById('fov-input'),
          oss = document.getElementById('ortho-size-slider'), osi = document.getElementById('ortho-size-input'),
          nc = document.getElementById('near-clip'), fc = document.getElementById('far-clip');
    mp.addEventListener('click', () => { mp.classList.add('active'); mo.classList.remove('active'); pc.style.display = 'block'; oc.style.display = 'none'; window.applyProjection(); });
    mo.addEventListener('click', () => { mo.classList.add('active'); mp.classList.remove('active'); pc.style.display = 'none'; oc.style.display = 'block'; window.applyProjection(); });
    window.applyProjection = function () {
        const aspect = window.innerWidth / window.innerHeight,
              near = parseFloat(nc.value) || 0.1,
              far = parseFloat(fc.value) || 1000;
        if (mp.classList.contains('active')) {
            const fov = parseFloat(fs.value) || 42;
            if (!(camera instanceof THREE.PerspectiveCamera)) {
                const pos = camera.position.clone(), t = controls.target.clone();
                camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
                camera.position.copy(pos);
                controls.object = camera;
                controls.target.copy(t);
            } else {
                camera.fov = fov;
                camera.aspect = aspect;
                camera.near = near;
                camera.far = far;
                camera.updateProjectionMatrix();
            }
        } else {
            const size = parseFloat(oss.value) || 5;
            const hw = size * aspect, hh = size;
            if (!(camera instanceof THREE.OrthographicCamera)) {
                const pos = camera.position.clone(), t = controls.target.clone();
                camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, near, far);
                camera.position.copy(pos);
                controls.object = camera;
                controls.target.copy(t);
            } else {
                camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
                camera.near = near; camera.far = far; camera.updateProjectionMatrix();
            }
        }
        controls.update();
    };
    fs.addEventListener('input', () => { fi.value = fs.value; window.applyProjection(); });
    fi.addEventListener('change', () => { let v = parseFloat(fi.value); v = Math.min(179, Math.max(1, v)); fs.value = v; window.applyProjection(); });
    oss.addEventListener('input', () => { osi.value = oss.value; window.applyProjection(); });
    osi.addEventListener('change', () => { let v = parseFloat(osi.value); v = Math.min(100, Math.max(0.1, v)); oss.value = v; window.applyProjection(); });
    nc.addEventListener('change', window.applyProjection);
    fc.addEventListener('change', window.applyProjection);
    cameraPanelBuilt = true;
    syncCameraFromOffset();
}

// ========== 注入坐标与旋转控件 ==========
function injectCoordAndRotateControls() {
    const shapePanels = ['sphere', 'cylinder', 'cone', 'frustum', 'torus', 'pipe', 'cube', 'square-tube', 'pyramid', 'prism-frustum', 'plane'];
    shapePanels.forEach(shapeId => {
        const panel = document.getElementById(`${shapeId}-settings-panel`);
        if (!panel) return;
        if (panel.querySelector('.coord-rotate-wrapper')) return;
        let shapeKey = shapeId;
        if (shapeId === 'frustum') shapeKey = 'frustum_cone';
        else if (shapeId === 'prism-frustum') shapeKey = 'prism_frustum';
        else if (shapeId === 'square-tube') shapeKey = 'square_tube';
        const prefix = shapeKey + '-';
        const wrapper = document.createElement('div');
        wrapper.className = 'coord-rotate-wrapper';
        let innerHTML = `
            <div class="control-group" style="margin-top:12px;">
                <div class="control-title">模型坐标</div>
                <div class="control-row"><span class="control-label">X</span><input type="number" id="pos-x-${shapeKey}" class="coord-input" step="1" value="0"></div>
                <div class="control-row"><span class="control-label">Y</span><input type="number" id="pos-y-${shapeKey}" class="coord-input" step="1" value="0"></div>
                <div class="control-row"><span class="control-label">Z</span><input type="number" id="pos-z-${shapeKey}" class="coord-input" step="1" value="0"></div>
            </div>
        `;
        if (shapeKey === 'plane') {
            innerHTML += `
            <div class="control-group" id="plane-orientation-group">
                <div class="control-title">平面朝向</div>
                <div class="control-row" style="display:flex; gap:6px;">
                    <button class="toggle-btn orientation-btn" data-orient="front">平面朝前</button>
                    <button class="toggle-btn orientation-btn" data-orient="up">平面朝上</button>
                    <button class="toggle-btn orientation-btn" data-orient="left">平面朝左</button>
                </div>
            </div>
            `;
        }
        innerHTML += `
            <div class="control-group">
                <div class="control-title">旋转</div>
                <div class="control-row"><button class="toggle-btn" id="${prefix}toggle-x">绕X轴旋转</button></div>
                <div class="speed-control"><span>转/分</span><input type="number" id="${prefix}speed-x" class="speed-input" value="2.0" step="0.5" min="0.1" max="30"><button class="dir-btn" id="${prefix}dir-x">正转</button></div>
                <div class="control-row" style="margin-top:6px;"><button class="toggle-btn" id="${prefix}toggle-y">绕Y轴旋转</button></div>
                <div class="speed-control"><span>转/分</span><input type="number" id="${prefix}speed-y" class="speed-input" value="2.0" step="0.5" min="0.1" max="30"><button class="dir-btn" id="${prefix}dir-y">正转</button></div>
                <div class="control-row" style="margin-top:6px;"><button class="toggle-btn" id="${prefix}toggle-z">绕Z轴旋转</button></div>
                <div class="speed-control"><span>转/分</span><input type="number" id="${prefix}speed-z" class="speed-input" value="2.0" step="0.5" min="0.1" max="30"><button class="dir-btn" id="${prefix}dir-z">正转</button></div>
            </div>
            <div class="control-group">
                <div class="control-title">挪移</div>
                <div class="control-row"><button class="toggle-btn" id="${prefix}nudge-on-btn">挪移</button><button class="toggle-btn active" id="${prefix}nudge-off-btn">静止</button></div>
            </div>
            <div class="control-group">
                <div class="control-title">滑动</div>
                <div class="control-row"><button class="toggle-btn active" id="${prefix}slide-on-btn">滑动</button><button class="toggle-btn" id="${prefix}slide-off-btn">静止</button></div>
            </div>
            <div class="control-group">
                <div class="control-title">缩放</div>
                <div class="control-row"><button class="toggle-btn active" id="${prefix}zoom-on-btn">缩放</button><button class="toggle-btn" id="${prefix}zoom-off-btn">静止</button></div>
            </div>
        `;
        wrapper.innerHTML = innerHTML;
        panel.appendChild(wrapper);
        const px = wrapper.querySelector(`#pos-x-${shapeKey}`);
        const py = wrapper.querySelector(`#pos-y-${shapeKey}`);
        const pz = wrapper.querySelector(`#pos-z-${shapeKey}`);
        const applyPos = () => {
            if (currentShape !== shapeKey || !currentModel) return;
            const x = parseFloat(px.value) || 0;
            const y = parseFloat(py.value) || 0;
            const z = parseFloat(pz.value) || 0;
            currentModel.position.set(x, y, z);
            controls.target.set(x, y, z);
            syncCameraFromOffset();
        };
        px.addEventListener('input', applyPos);
        py.addEventListener('input', applyPos);
        pz.addEventListener('input', applyPos);
        ['x','y','z'].forEach(axis => {
            const tb = document.getElementById(`${prefix}toggle-${axis}`);
            const si = document.getElementById(`${prefix}speed-${axis}`);
            const db = document.getElementById(`${prefix}dir-${axis}`);
            const axisName = axis.toUpperCase();
            if (tb) {
                tb.addEventListener('click', () => {
                    const meta = getMetaForShape(shapeKey);
                    meta.autoRotate[axis] = !meta.autoRotate[axis];
                    tb.classList.toggle('active', meta.autoRotate[axis]);
                    tb.textContent = meta.autoRotate[axis] ? `绕${axisName}轴旋转中` : `绕${axisName}轴旋转`;
                });
            }
            if (si) {
                si.addEventListener('input', () => {
                    const meta = getMetaForShape(shapeKey);
                    meta.rotateSpeed[axis] = parseFloat(si.value) || 2;
                });
            }
            if (db) {
                db.addEventListener('click', () => {
                    const meta = getMetaForShape(shapeKey);
                    meta.rotateDir[axis] *= -1;
                    db.textContent = meta.rotateDir[axis] === 1 ? '正转' : '反转';
                });
            }
        });
        const setInteract = (type, active) => {
            const onBtn = document.getElementById(`${prefix}${type}-on-btn`);
            const offBtn = document.getElementById(`${prefix}${type}-off-btn`);
            if (!onBtn || !offBtn) return;
            onBtn.classList.toggle('active', active);
            offBtn.classList.toggle('active', !active);
            if (currentShape === shapeKey) {
                switch (type) {
                    case 'nudge': controls.enablePan = active; break;
                    case 'slide': controls.enableRotate = active; break;
                    case 'zoom': controls.enableZoom = active; break;
                }
            }
        };
        document.getElementById(`${prefix}nudge-on-btn`).addEventListener('click', () => setInteract('nudge', true));
        document.getElementById(`${prefix}nudge-off-btn`).addEventListener('click', () => setInteract('nudge', false));
        document.getElementById(`${prefix}slide-on-btn`).addEventListener('click', () => setInteract('slide', true));
        document.getElementById(`${prefix}slide-off-btn`).addEventListener('click', () => setInteract('slide', false));
        document.getElementById(`${prefix}zoom-on-btn`).addEventListener('click', () => setInteract('zoom', true));
        document.getElementById(`${prefix}zoom-off-btn`).addEventListener('click', () => setInteract('zoom', false));
        if (shapeKey === 'plane') {
            const orientBtns = wrapper.querySelectorAll('.orientation-btn');
            function setOrientationActive(orient) {
                orientBtns.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.orient === orient);
                });
            }
            setOrientationActive(planeOrientation);
            orientBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const newOrient = btn.dataset.orient;
                    if (planeOrientation === newOrient) return;
                    planeOrientation = newOrient;
                    setOrientationActive(newOrient);
                    if (currentShape === 'plane') {
                        updateModel('plane');
                        syncPlaneRotation();
                    }
                });
            });
        }
    });

    window.syncInteractionButtons = function() {
        const prefix = currentShape + '-';
        const setInteract = (type, active) => {
            const onBtn = document.getElementById(`${prefix}${type}-on-btn`);
            const offBtn = document.getElementById(`${prefix}${type}-off-btn`);
            if (onBtn) onBtn.classList.toggle('active', active);
            if (offBtn) offBtn.classList.toggle('active', !active);
        };
        setInteract('nudge', controls.enablePan);
        setInteract('slide', controls.enableRotate);
        setInteract('zoom', controls.enableZoom);
    };
    window.syncInteractionButtons();
}

// ========== 材质面板 ==========
function buildMaterialPanel() {
    const cont = document.getElementById('material-controls-container');
    cont.innerHTML = `<div class="control-group"><div class="control-title">材质类型</div><div class="control-row"><label class="radio-option"><input type="radio" name="mat-type" value="basic"> Basic</label><label class="radio-option"><input type="radio" name="mat-type" value="standard" checked> Standard</label><label class="radio-option"><input type="radio" name="mat-type" value="physical"> Physical</label></div></div><div class="control-group"><div class="control-title">基础属性</div><div class="control-row"><span class="control-label">基础色</span><input type="color" id="mat-color" value="#ff6600"><span id="mat-color-val">#ff6600</span></div><div class="control-row"><span class="control-label">金属度</span><input type="range" id="mat-metalness" min="0" max="1" value="0.78" step="0.01"><span class="slider-value" id="mat-metalness-val">0.78</span></div><div class="control-row"><span class="control-label">粗糙度</span><input type="range" id="mat-roughness" min="0" max="1" value="0.22" step="0.01"><span class="slider-value" id="mat-roughness-val">0.22</span></div><div class="control-row"><span class="control-label">自发光色</span><input type="color" id="mat-emissive" value="#000000"><span id="mat-emissive-val">#000000</span></div><div class="control-row"><span class="control-label">自发光强度</span><input type="range" id="mat-emissive-intensity" min="0" max="2" value="0.1" step="0.05"><span class="slider-value" id="mat-emissive-intensity-val">0.10</span></div><div class="control-row"><span class="control-label">启用透明</span><input type="checkbox" id="mat-transparent"><span style="font-size:0.8rem;">(透明/半透明请启用)</span></div><div class="control-row"><span class="control-label">透明度</span><input type="range" id="mat-opacity" min="0" max="1" value="0.18" step="0.01"><span class="slider-value" id="mat-opacity-val">0.18</span></div></div><div class="control-group"><div class="control-title">纹理贴图</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"><div><button class="texture-ctrl-btn" id="mat-diffuse-upload">漫反射</button><button class="texture-ctrl-btn clear-btn" id="mat-diffuse-clear">✕</button></div><div><button class="texture-ctrl-btn" id="mat-metalrough-upload">金属/粗糙</button><button class="texture-ctrl-btn clear-btn" id="mat-metalrough-clear">✕</button></div><div><button class="texture-ctrl-btn" id="mat-normal-upload">法线</button><button class="texture-ctrl-btn clear-btn" id="mat-normal-clear">✕</button></div><div><button class="texture-ctrl-btn" id="mat-emissive-upload">自发光</button><button class="texture-ctrl-btn clear-btn" id="mat-emissive-clear">✕</button></div></div></div><div class="control-group"><div class="control-title">纹理变换</div><div class="control-row"><span class="control-label">重复UV</span><input type="number" id="tex-repeat-u" class="coord-input" value="1" step="0.01"><input type="number" id="tex-repeat-v" class="coord-input" value="1" step="0.01"></div><div class="control-row"><span class="control-label">偏移UV</span><input type="number" id="tex-offset-u" class="coord-input" value="0" step="0.01"><input type="number" id="tex-offset-v" class="coord-input" value="0" step="0.01"></div><div class="control-row"><span class="control-label">旋转</span><input type="number" id="tex-rotation" class="coord-input" value="0" step="0.01"></div></div><div class="control-group"><div class="control-title">快速预设</div><div class="preset-grid"><button class="preset-btn" data-mat-preset="metal">金属</button><button class="preset-btn" data-mat-preset="plastic">塑料</button><button class="preset-btn" data-mat-preset="rubber">橡胶</button><button class="preset-btn" data-mat-preset="glass">玻璃</button><button class="preset-btn" data-mat-preset="emissive">发光</button></div></div>`;
    function applyTexTransform() { const ru=parseFloat(document.getElementById('tex-repeat-u').value)||1, rv=parseFloat(document.getElementById('tex-repeat-v').value)||1, ou=parseFloat(document.getElementById('tex-offset-u').value)||0, ov=parseFloat(document.getElementById('tex-offset-v').value)||0, rot=parseFloat(document.getElementById('tex-rotation').value)||0; Object.values(materialTextures).forEach(tex=>{ if(tex){ tex.repeat.set(ru,rv); tex.offset.set(ou,ov); tex.rotation=rot; tex.needsUpdate=true; } }); Object.values(textureStore).forEach(tex=>{ if(tex&&tex.isTexture){ tex.repeat.set(ru,rv); tex.offset.set(ou,ov); tex.rotation=rot; tex.needsUpdate=true; } }); }
    document.getElementById('tex-repeat-u').addEventListener('input',applyTexTransform); document.getElementById('tex-repeat-v').addEventListener('input',applyTexTransform);
    document.getElementById('tex-offset-u').addEventListener('input',applyTexTransform); document.getElementById('tex-offset-v').addEventListener('input',applyTexTransform);
    document.getElementById('tex-rotation').addEventListener('input',applyTexTransform);
    function applyMatFromUI() { if(!currentModel)return; const color=document.getElementById('mat-color').value, metalness=parseFloat(document.getElementById('mat-metalness').value), roughness=parseFloat(document.getElementById('mat-roughness').value), emissive=document.getElementById('mat-emissive').value, emissiveIntensity=parseFloat(document.getElementById('mat-emissive-intensity').value), transparent=document.getElementById('mat-transparent').checked, transparency=parseFloat(document.getElementById('mat-opacity').value), type=document.querySelector('input[name="mat-type"]:checked')?.value||'standard', opacity = transparent ? (1 - transparency) : 1.0; const params={color:new THREE.Color(color),metalness,roughness,emissive:new THREE.Color(emissive),emissiveIntensity,side:THREE.DoubleSide,transparent,opacity}; if(type==='physical'){ params.clearcoat=0.5; params.clearcoatRoughness=0.1; } if(type==='basic'){ delete params.metalness; delete params.roughness; delete params.emissiveIntensity; } if(materialTextures.diffuse) params.map=materialTextures.diffuse; if(materialTextures.normal&&type!=='basic') params.normalMap=materialTextures.normal; if(materialTextures.emissive) params.emissiveMap=materialTextures.emissive; if(materialTextures.metalRough&&type!=='basic'){ params.metalnessMap=materialTextures.metalRough; params.roughnessMap=materialTextures.metalRough; } const MatClass=type==='basic'?THREE.MeshBasicMaterial:type==='physical'?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial; const newMat=new MatClass(params); const oldMat=currentModel.material; if(Array.isArray(currentModel.material)) currentModel.material=newMat; else if(currentModel.isGroup) currentModel.children.forEach(c=>{ if(c.material){ c.material.dispose(); c.material=newMat.clone(); } }); else currentModel.material=newMat; if(oldMat&&oldMat!==newMat) oldMat.dispose(); }
    document.getElementById('mat-color').addEventListener('input',function(){ document.getElementById('mat-color-val').textContent=this.value; applyMatFromUI(); });
    document.getElementById('mat-metalness').addEventListener('input',function(){ document.getElementById('mat-metalness-val').textContent=parseFloat(this.value).toFixed(2); applyMatFromUI(); });
    document.getElementById('mat-roughness').addEventListener('input',function(){ document.getElementById('mat-roughness-val').textContent=parseFloat(this.value).toFixed(2); applyMatFromUI(); });
    document.getElementById('mat-emissive').addEventListener('input',function(){ document.getElementById('mat-emissive-val').textContent=this.value; applyMatFromUI(); });
    document.getElementById('mat-emissive-intensity').addEventListener('input',function(){ document.getElementById('mat-emissive-intensity-val').textContent=parseFloat(this.value).toFixed(2); applyMatFromUI(); });
    document.getElementById('mat-transparent').addEventListener('change',applyMatFromUI);
    document.getElementById('mat-opacity').addEventListener('input',function(){ document.getElementById('mat-opacity-val').textContent=parseFloat(this.value).toFixed(2); applyMatFromUI(); });
    document.querySelectorAll('input[name="mat-type"]').forEach(r=>r.addEventListener('change',applyMatFromUI));
    function setupMatTex(bid,cbid,key,fid){ document.getElementById(bid).addEventListener('click',()=>document.getElementById(fid).click()); document.getElementById(cbid).addEventListener('click',()=>{ if(materialTextures[key]){ if(materialTextures[key].isVideoTexture){ const v=materialTextures[key].image||materialTextures[key].source; if(v&&v.pause){ v.pause(); v.removeAttribute('src'); v.load(); } } materialTextures[key].dispose(); materialTextures[key]=null; } applyMatFromUI(); }); }
    setupMatTex('mat-diffuse-upload','mat-diffuse-clear','diffuse','hidden-mat-diffuse-input');
    setupMatTex('mat-metalrough-upload','mat-metalrough-clear','metalRough','hidden-mat-metalrough-input');
    setupMatTex('mat-normal-upload','mat-normal-clear','normal','hidden-mat-normal-input');
    setupMatTex('mat-emissive-upload','mat-emissive-clear','emissive','hidden-mat-emissive-input');
    function loadMatTex(fid,key){ const inp=document.getElementById(fid); inp.addEventListener('change',()=>{ const file=inp.files[0]; if(!file)return; createMediaTexture(file,tex=>{ tex.repeat.set(parseFloat(document.getElementById('tex-repeat-u').value)||1,parseFloat(document.getElementById('tex-repeat-v').value)||1); tex.offset.set(parseFloat(document.getElementById('tex-offset-u').value)||0,parseFloat(document.getElementById('tex-offset-v').value)||0); tex.rotation=parseFloat(document.getElementById('tex-rotation').value)||0; tex.needsUpdate=true; if(materialTextures[key]){ if(materialTextures[key].isVideoTexture){ const v=materialTextures[key].image||materialTextures[key].source; if(v&&v.pause){ v.pause(); v.removeAttribute('src'); v.load(); } } materialTextures[key].dispose(); } materialTextures[key]=tex; applyMatFromUI(); inp.value=''; }); }); }
    loadMatTex('hidden-mat-diffuse-input','diffuse'); loadMatTex('hidden-mat-metalrough-input','metalRough'); loadMatTex('hidden-mat-normal-input','normal'); loadMatTex('hidden-mat-emissive-input','emissive');
    document.querySelectorAll('.preset-btn[data-mat-preset]').forEach(b=>{ b.addEventListener('click',()=>{ const presets={metal:{color:'#c0c0c0',metalness:1.0,roughness:0.2,emissive:'#000000',emissiveIntensity:0,transparency:0.18},plastic:{color:'#e8e8e8',metalness:0.0,roughness:0.3,emissive:'#000000',emissiveIntensity:0,transparency:0.18},rubber:{color:'#333333',metalness:0.0,roughness:0.9,emissive:'#000000',emissiveIntensity:0,transparency:0.18},glass:{color:'#ddeeff',metalness:0.1,roughness:0.05,emissive:'#000000',emissiveIntensity:0,transparency:0.5},emissive:{color:'#ff6600',metalness:0.5,roughness:0.3,emissive:'#ff4400',emissiveIntensity:1.5,transparency:0.18}}; const p=presets[b.dataset.matPreset]; if(!p)return; document.getElementById('mat-color').value=p.color; document.getElementById('mat-color-val').textContent=p.color; document.getElementById('mat-metalness').value=p.metalness; document.getElementById('mat-metalness-val').textContent=p.metalness.toFixed(2); document.getElementById('mat-roughness').value=p.roughness; document.getElementById('mat-roughness-val').textContent=p.roughness.toFixed(2); document.getElementById('mat-emissive').value=p.emissive; document.getElementById('mat-emissive-val').textContent=p.emissive; document.getElementById('mat-emissive-intensity').value=p.emissiveIntensity; document.getElementById('mat-emissive-intensity-val').textContent=p.emissiveIntensity.toFixed(2); document.getElementById('mat-opacity').value=p.transparency; document.getElementById('mat-opacity-val').textContent=p.transparency.toFixed(2); document.querySelectorAll('.preset-btn[data-mat-preset]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); document.querySelector('input[name="mat-type"][value="standard"]').checked=true; applyMatFromUI(); }); });
    refreshMaterialPanel();
}
function refreshMaterialPanel(){ if(!currentModel||!currentModel.material)return; const mat=currentModel.material; if(mat.color&&document.getElementById('mat-color')){ document.getElementById('mat-color').value='#'+mat.color.getHexString(); document.getElementById('mat-color-val').textContent='#'+mat.color.getHexString(); } if(mat.metalness!==undefined){ const s=document.getElementById('mat-metalness'),v=document.getElementById('mat-metalness-val'); if(s&&v){ s.value=mat.metalness; v.textContent=mat.metalness.toFixed(2); } } if(mat.roughness!==undefined){ const s=document.getElementById('mat-roughness'),v=document.getElementById('mat-roughness-val'); if(s&&v){ s.value=mat.roughness; v.textContent=mat.roughness.toFixed(2); } } if(mat.emissive&&document.getElementById('mat-emissive')){ document.getElementById('mat-emissive').value='#'+mat.emissive.getHexString(); document.getElementById('mat-emissive-val').textContent='#'+mat.emissive.getHexString(); } if(mat.emissiveIntensity!==undefined){ const s=document.getElementById('mat-emissive-intensity'),v=document.getElementById('mat-emissive-intensity-val'); if(s&&v){ s.value=mat.emissiveIntensity; v.textContent=mat.emissiveIntensity.toFixed(2); } } const tc=document.getElementById('mat-transparent'),os=document.getElementById('mat-opacity'),ov=document.getElementById('mat-opacity-val'); if(tc&&os&&ov){ tc.checked=!!mat.transparent; const curTransparency = mat.transparent ? (1 - mat.opacity) : 0.18; os.value=curTransparency; ov.textContent=curTransparency.toFixed(2); } const type=mat.isMeshBasicMaterial?'basic':mat.isMeshPhysicalMaterial?'physical':'standard'; const radio=document.querySelector(`input[name="mat-type"][value="${type}"]`); if(radio) radio.checked=true; }

// ========== 渲染面板 ==========
function buildRenderPanel(){ const cont=document.getElementById('render-controls-container'); cont.innerHTML=`<div class="control-group"><div class="control-title">背景</div><div class="control-row"><span class="control-label">背景颜色</span><input type="color" id="render-bg-color" value="#050518"><span id="render-bg-color-val">#050518</span></div></div><div class="control-group"><div class="control-title">阴影</div><div class="control-row"><span class="control-label">阴影类型</span><div class="option-group"><label class="option-label"><input type="radio" name="shadow-type" value="basic"> 基本</label><label class="option-label"><input type="radio" name="shadow-type" value="pcf"> PCF</label><label class="option-label selected"><input type="radio" name="shadow-type" value="pcfsoft" checked> PCFSoft</label></div></div><div class="control-row"><span class="control-label">贴图尺寸</span><div class="option-group"><label class="option-label"><input type="radio" name="shadow-map-size" value="512"> 512</label><label class="option-label selected"><input type="radio" name="shadow-map-size" value="1024" checked> 1024</label><label class="option-label"><input type="radio" name="shadow-map-size" value="2048"> 2048</label></div></div><div class="control-row"><span class="control-label">偏移(Bias)</span><input type="range" id="shadow-bias" min="0" max="0.01" value="0.0005" step="0.0001"><span class="slider-value" id="shadow-bias-val">0.0005</span></div></div><div class="control-group"><div class="control-title">抗锯齿</div><div class="option-group"><label class="option-label selected"><input type="radio" name="aa-method" value="none" checked> 无</label><label class="option-label"><input type="radio" name="aa-method" value="fxaa"> FXAA</label></div></div><div class="control-group"><div class="control-title">色调映射</div><div class="option-group"><label class="option-label"><input type="radio" name="tone-mapping" value="none"> 无</label><label class="option-label selected"><input type="radio" name="tone-mapping" value="aces" checked> ACES</label><label class="option-label"><input type="radio" name="tone-mapping" value="reinhard"> Reinhard</label></div><div class="control-row" style="margin-top:8px;"><span class="control-label">曝光度</span><input type="range" id="exposure" min="0.2" max="2" value="1.0" step="0.1"><span class="slider-value" id="exposure-val">1.0</span></div></div><div class="control-group"><div class="control-title">预设</div><div class="preset-grid"><button class="preset-btn active" data-render-preset="performance">性能</button><button class="preset-btn" data-render-preset="balanced">平衡</button><button class="preset-btn" data-render-preset="quality">质量</button><button class="preset-btn" data-render-preset="cinematic">电影</button></div></div>`; document.getElementById('render-bg-color').addEventListener('input',function(){ scene.background=new THREE.Color(this.value); document.getElementById('render-bg-color-val').textContent=this.value; }); document.querySelectorAll('input[name="shadow-type"]').forEach(r=>r.addEventListener('change',()=>{ const v=document.querySelector('input[name="shadow-type"]:checked').value; const m={basic:THREE.BasicShadowMap,pcf:THREE.PCFShadowMap,pcfsoft:THREE.PCFSoftShadowMap}; renderer.shadowMap.type=m[v]||THREE.PCFSoftShadowMap; })); document.querySelectorAll('input[name="shadow-map-size"]').forEach(r=>r.addEventListener('change',()=>{ const sz=parseInt(document.querySelector('input[name="shadow-map-size"]:checked').value); if(dirLight&&dirLight.shadow){ dirLight.shadow.mapSize.width=sz; dirLight.shadow.mapSize.height=sz; dirLight.shadow.map.dispose(); dirLight.shadow.map=null; } })); document.getElementById('shadow-bias').addEventListener('input',function(){ document.getElementById('shadow-bias-val').textContent=this.value; if(dirLight&&dirLight.shadow) dirLight.shadow.bias=-parseFloat(this.value); }); document.querySelectorAll('input[name="aa-method"]').forEach(r=>r.addEventListener('change',()=>{ const v=document.querySelector('input[name="aa-method"]:checked').value; fxaaEnabled=(v==='fxaa'); fxaaPass.enabled=fxaaEnabled; })); document.querySelectorAll('input[name="tone-mapping"]').forEach(r=>r.addEventListener('change',()=>{ const v=document.querySelector('input[name="tone-mapping"]:checked').value; const m={none:THREE.NoToneMapping,aces:THREE.ACESFilmicToneMapping,reinhard:THREE.ReinhardToneMapping}; renderer.toneMapping=m[v]||THREE.ACESFilmicToneMapping; })); document.getElementById('exposure').addEventListener('input',function(){ document.getElementById('exposure-val').textContent=parseFloat(this.value).toFixed(1); renderer.toneMappingExposure=parseFloat(this.value); }); document.querySelectorAll('.preset-btn[data-render-preset]').forEach(b=>b.addEventListener('click',()=>{ const pr={performance:{shadowSize:512,shadowType:'basic',toneMapping:'none',exposure:1.0,aa:'none'},balanced:{shadowSize:1024,shadowType:'pcf',toneMapping:'aces',exposure:1.0,aa:'none'},quality:{shadowSize:2048,shadowType:'pcfsoft',toneMapping:'aces',exposure:1.0,aa:'fxaa'},cinematic:{shadowSize:2048,shadowType:'pcfsoft',toneMapping:'aces',exposure:1.3,aa:'fxaa'}}; const p=pr[b.dataset.renderPreset]; if(!p)return; const szR=document.querySelector(`input[name="shadow-map-size"][value="${p.shadowSize}"]`); if(szR){ szR.checked=true; szR.dispatchEvent(new Event('change')); } const tyR=document.querySelector(`input[name="shadow-type"][value="${p.shadowType}"]`); if(tyR){ tyR.checked=true; tyR.dispatchEvent(new Event('change')); } document.getElementById('exposure').value=p.exposure; document.getElementById('exposure-val').textContent=p.exposure.toFixed(1); renderer.toneMappingExposure=p.exposure; const tmR=document.querySelector(`input[name="tone-mapping"][value="${p.toneMapping}"]`); if(tmR){ tmR.checked=true; tmR.dispatchEvent(new Event('change')); } const aaR=document.querySelector(`input[name="aa-method"][value="${p.aa}"]`); if(aaR){ aaR.checked=true; aaR.dispatchEvent(new Event('change')); } document.querySelectorAll('.preset-btn[data-render-preset]').forEach(x=>x.classList.remove('active')); b.classList.add('active'); })); }

// ========== 场景面板 ==========
function buildScenePanel(){ const cont=document.getElementById('scene-controls-container'); cont.innerHTML=`<div class="control-group"><div class="control-title">网格</div><div class="control-row"><button class="toggle-btn" id="grid-show-btn">显示</button><button class="toggle-btn active" id="grid-hide-btn">隐藏</button></div></div><div class="control-group"><div class="control-title">地平面</div><div class="control-row"><button class="toggle-btn" id="ground-show-btn">显示</button><button class="toggle-btn active" id="ground-hide-btn">隐藏</button></div><div class="control-row" style="margin-top:6px;"><span class="control-label">颜色</span><input type="color" id="ground-color-scene" value="#888888"></div><div class="control-row"><span class="control-label">大小</span><input type="range" id="ground-size" min="1" max="30" value="10" step="0.5"><span class="slider-value" id="ground-size-val">10.0</span></div><div class="control-row"><span class="control-label">纹理</span><button class="texture-ctrl-btn" id="ground-upload">⬆️</button><button class="texture-ctrl-btn clear-btn" id="ground-clear">🗑️</button></div></div><div class="control-group"><div class="control-title">背景</div><div class="control-row"><button class="toggle-btn" id="bg-show-btn">显示</button><button class="toggle-btn active" id="bg-hide-btn">隐藏</button></div><div class="control-row" style="margin-top:6px;"><span class="control-label">颜色</span><input type="color" id="bg-color-scene" value="#050518"></div><div class="control-row"><span class="control-label">纹理</span><button class="texture-ctrl-btn" id="bg-upload">⬆️</button><button class="texture-ctrl-btn clear-btn" id="bg-clear">🗑️</button></div></div>`; document.getElementById('grid-show-btn').addEventListener('click',()=>{ gridHelper.visible=true; document.getElementById('grid-show-btn').classList.add('active'); document.getElementById('grid-hide-btn').classList.remove('active'); }); document.getElementById('grid-hide-btn').addEventListener('click',()=>{ gridHelper.visible=false; document.getElementById('grid-hide-btn').classList.add('active'); document.getElementById('grid-show-btn').classList.remove('active'); }); document.getElementById('ground-show-btn').addEventListener('click',()=>{ groundMesh.visible=true; document.getElementById('ground-show-btn').classList.add('active'); document.getElementById('ground-hide-btn').classList.remove('active'); }); document.getElementById('ground-hide-btn').addEventListener('click',()=>{ groundMesh.visible=false; document.getElementById('ground-hide-btn').classList.add('active'); document.getElementById('ground-show-btn').classList.remove('active'); }); document.getElementById('ground-color-scene').addEventListener('input',function(){ groundMesh.material.color.set(this.value); }); document.getElementById('ground-size').addEventListener('input',function(){ const sz=parseFloat(this.value); document.getElementById('ground-size-val').textContent=sz.toFixed(1); const og=groundMesh.geometry; groundMesh.geometry=new THREE.CircleGeometry(sz,64); og.dispose(); }); document.getElementById('ground-upload').addEventListener('click',()=>document.getElementById('hidden-ground-file-input').click()); document.getElementById('ground-clear').addEventListener('click',()=>{ if(groundTexture){ groundTexture.dispose(); groundTexture=null; } groundMesh.material.map=null; groundMesh.material.needsUpdate=true; }); document.getElementById('hidden-ground-file-input').addEventListener('change',function(){ const f=this.files[0]; if(!f)return; const r=new FileReader(); r.onload=e=>{ const img=new Image(); img.onload=()=>{ if(groundTexture) groundTexture.dispose(); groundTexture=new THREE.Texture(img); groundTexture.wrapS=groundTexture.wrapT=THREE.RepeatWrapping; groundTexture.needsUpdate=true; groundMesh.material.map=groundTexture; groundMesh.material.needsUpdate=true; }; img.src=e.target.result; }; r.readAsDataURL(f); }); document.getElementById('bg-show-btn').addEventListener('click',()=>{ document.getElementById('bg-show-btn').classList.add('active'); document.getElementById('bg-hide-btn').classList.remove('active'); applySceneBg(); }); document.getElementById('bg-hide-btn').addEventListener('click',()=>{ document.getElementById('bg-hide-btn').classList.add('active'); document.getElementById('bg-show-btn').classList.remove('active'); scene.background=null; }); document.getElementById('bg-color-scene').addEventListener('input',applySceneBg); function applySceneBg(){ if(!document.getElementById('bg-show-btn').classList.contains('active'))return; if(bgTexture) scene.background=bgTexture; else scene.background=new THREE.Color(document.getElementById('bg-color-scene').value); } document.getElementById('bg-upload').addEventListener('click',()=>document.getElementById('hidden-bg-file-input').click()); document.getElementById('bg-clear').addEventListener('click',()=>{ if(bgTexture){ bgTexture.dispose(); bgTexture=null; } applySceneBg(); }); document.getElementById('hidden-bg-file-input').addEventListener('change',function(){ const f=this.files[0]; if(!f)return; const r=new FileReader(); r.onload=e=>{ const img=new Image(); img.onload=()=>{ if(bgTexture) bgTexture.dispose(); bgTexture=new THREE.Texture(img); bgTexture.needsUpdate=true; applySceneBg(); }; img.src=e.target.result; }; r.readAsDataURL(f); }); }

// ========== 重置函数 ==========
function resetPanelToDefaults(pid,sk){ const p=document.getElementById(pid); if(!p)return; const d=getDefaultParams(sk); const us=p.querySelector('.units-select'); if(us&&d.units) us.value=d.units; const ssl=(sid,iid,v)=>{ const s=document.getElementById(sid),i=document.getElementById(iid); if(s&&i){ s.value=v; i.value=v; s.dispatchEvent(new Event('input')); } }; switch(sk){ case'sphere': ssl('rx-slider','rx-input',d.rx); ssl('ry-slider','ry-input',d.ry); ssl('rz-slider','rz-input',d.rz); break; case'cylinder': ssl('radius-slider','radius-input',d.radius); ssl('height-slider','height-input',d.height); break; case'cone': ssl('cone-radius-slider','cone-radius-input',d.radius); ssl('cone-height-slider','cone-height-input',d.height); break; case'frustum_cone': ssl('top-radius-slider','top-radius-input',d.topRadius); ssl('bottom-radius-slider','bottom-radius-input',d.bottomRadius); ssl('frustum-height-slider','frustum-height-input',d.height); break; case'torus': ssl('tube-radius-slider','tube-radius-input',d.tubeRadius); ssl('ring-radius-slider','ring-radius-input',d.ringRadius); break; case'pipe': ssl('outer-radius-slider','outer-radius-input',d.outerRadius); ssl('inner-radius-slider','inner-radius-input',d.innerRadius); ssl('pipe-length-slider','pipe-length-input',d.length); break; case'square_tube': ssl('outer-width-slider','outer-width-input',d.outerWidth); ssl('outer-height-slider','outer-height-input',d.outerHeight); ssl('inner-width-slider','inner-width-input',d.innerWidth); ssl('inner-height-slider','inner-height-input',d.innerHeight); ssl('square-length-slider','square-length-input',d.length); break; case'cube': ssl('cube-width-slider','cube-width-input',d.width); ssl('cube-depth-slider','cube-depth-input',d.depth); ssl('cube-height-slider','cube-height-input',d.height); break; case'pyramid': ssl('pyramid-width-slider','pyramid-width-input',d.width); ssl('pyramid-depth-slider','pyramid-depth-input',d.depth); ssl('pyramid-height-slider','pyramid-height-input',d.height); break; case'prism_frustum': ssl('top-width-slider','top-width-input',d.topWidth); ssl('top-depth-slider','top-depth-input',d.topDepth); ssl('bottom-width-slider','bottom-width-input',d.bottomWidth); ssl('bottom-depth-slider','bottom-depth-input',d.bottomDepth); ssl('prism-height-slider','prism-height-input',d.height); break; case'plane': ssl('plane-width-slider','plane-width-input',d.width); ssl('plane-height-slider','plane-height-input',d.height); break; } if(currentShape===sk) updateModel(sk); }
function resetPositioning(){ cameraOffset={x:0,y:0,z:10}; document.getElementById('cam-offset-x-slider').value=0; document.getElementById('cam-offset-x-input').value=0; document.getElementById('cam-offset-y-slider').value=0; document.getElementById('cam-offset-y-input').value=0; document.getElementById('cam-offset-z-slider').value=10; document.getElementById('cam-offset-z-input').value=10; syncCameraFromOffset(); if(document.getElementById('mode-persp')) document.getElementById('mode-persp').click(); }
function resetMaterial(){ document.querySelector('input[name="mat-type"][value="standard"]').checked=true; document.getElementById('mat-color').value='#ff6600'; document.getElementById('mat-color-val').textContent='#ff6600'; document.getElementById('mat-metalness').value=0.78; document.getElementById('mat-metalness-val').textContent='0.78'; document.getElementById('mat-roughness').value=0.22; document.getElementById('mat-roughness-val').textContent='0.22'; document.getElementById('mat-emissive').value='#000000'; document.getElementById('mat-emissive-val').textContent='#000000'; document.getElementById('mat-emissive-intensity').value=0.1; document.getElementById('mat-emissive-intensity-val').textContent='0.10'; document.getElementById('mat-transparent').checked=false; document.getElementById('mat-opacity').value=0.18; document.getElementById('mat-opacity-val').textContent='0.18'; document.getElementById('tex-repeat-u').value=1; document.getElementById('tex-repeat-v').value=1; document.getElementById('tex-offset-u').value=0; document.getElementById('tex-offset-v').value=0; document.getElementById('tex-rotation').value=0; for(const k of Object.keys(materialTextures)){ if(materialTextures[k]){ if(materialTextures[k].isVideoTexture){ const v=materialTextures[k].image||materialTextures[k].source; if(v&&v.pause){ v.pause(); v.removeAttribute('src'); v.load(); } } materialTextures[k].dispose(); materialTextures[k]=null; } } Object.values(textureStore).forEach(tex=>{ if(tex&&tex.isTexture){ tex.repeat.set(1,1); tex.offset.set(0,0); tex.rotation=0; } }); if(currentModel){ const params={color:new THREE.Color('#ff6600'),metalness:0.78,roughness:0.22,emissive:new THREE.Color('#000000'),emissiveIntensity:0.1,side:THREE.DoubleSide,transparent:false,opacity:1.0}; const oldMat=currentModel.material; const newMat=new THREE.MeshStandardMaterial(params); if(Array.isArray(currentModel.material)) currentModel.material=newMat; else if(currentModel.isGroup) currentModel.children.forEach(c=>{ if(c.material){ c.material.dispose(); c.material=newMat.clone(); } }); else currentModel.material=newMat; if(oldMat&&oldMat!==newMat) oldMat.dispose(); } document.querySelectorAll('.preset-btn[data-mat-preset]').forEach(b=>b.classList.remove('active')); }
function resetRender(){ scene.background=new THREE.Color('#050518'); document.getElementById('render-bg-color').value='#050518'; document.getElementById('render-bg-color-val').textContent='#050518'; const st=document.querySelector('input[name="shadow-type"][value="pcfsoft"]'); if(st){ st.checked=true; st.dispatchEvent(new Event('change')); } const ss=document.querySelector('input[name="shadow-map-size"][value="1024"]'); if(ss){ ss.checked=true; ss.dispatchEvent(new Event('change')); } document.getElementById('shadow-bias').value=0.0005; document.getElementById('shadow-bias-val').textContent='0.0005'; dirLight.shadow.bias=-0.0005; document.querySelector('input[name="aa-method"][value="none"]').checked=true; fxaaPass.enabled=false; fxaaEnabled=false; const tm=document.querySelector('input[name="tone-mapping"][value="aces"]'); if(tm){ tm.checked=true; tm.dispatchEvent(new Event('change')); } document.getElementById('exposure').value=1.0; document.getElementById('exposure-val').textContent='1.0'; renderer.toneMappingExposure=1.0; document.querySelectorAll('.preset-btn[data-render-preset]').forEach(b=>b.classList.remove('active')); const perf=document.querySelector('.preset-btn[data-render-preset="performance"]'); if(perf) perf.classList.add('active'); }
function resetScene(){ gridHelper.visible=true; document.getElementById('grid-show-btn').classList.add('active'); document.getElementById('grid-hide-btn').classList.remove('active'); groundMesh.visible=false; document.getElementById('ground-hide-btn').classList.add('active'); document.getElementById('ground-show-btn').classList.remove('active'); groundMesh.material.color.set('#888888'); document.getElementById('ground-color-scene').value='#888888'; document.getElementById('ground-size').value=10; document.getElementById('ground-size-val').textContent='10.0'; const og=groundMesh.geometry; groundMesh.geometry=new THREE.CircleGeometry(10,64); og.dispose(); if(groundTexture){ groundTexture.dispose(); groundTexture=null; } groundMesh.material.map=null; groundMesh.material.needsUpdate=true; document.getElementById('bg-hide-btn').classList.add('active'); document.getElementById('bg-show-btn').classList.remove('active'); document.getElementById('bg-color-scene').value='#050518'; if(bgTexture){ bgTexture.dispose(); bgTexture=null; } scene.background=new THREE.Color('#050518'); }
function resetTexture(){ for(const k of Object.keys(textureStore)){ const tex=textureStore[k]; if(tex){ if(tex.isVideoTexture){ const v=tex.image||tex.source; if(v&&v.pause){ v.pause(); v.removeAttribute('src'); v.load(); } } tex.dispose(); } delete textureStore[k]; } updateModel(currentShape); if(document.getElementById('texture-settings-panel').classList.contains('visible')) updateTexturePanelContent(); }
function resetRotate(){ modelsMeta[currentShape]=getDefaultMeta(); loadMetaToUI(currentShape); controls.enablePan = false; controls.enableRotate = true; controls.enableZoom = true; if (window.syncInteractionButtons) syncInteractionButtons(); }

// 全局重置所有几何体（供顶部♊️按钮调用）
function resetAllGeometry() {
    const shapes = Object.keys(DEFAULT_PARAMS);
    shapes.forEach(shape => {
        let panelId;
        if (shape === 'frustum_cone') panelId = 'frustum-settings-panel';
        else if (shape === 'prism_frustum') panelId = 'prism-frustum-settings-panel';
        else if (shape === 'square_tube') panelId = 'square-tube-settings-panel';
        else panelId = shape + '-settings-panel';
        if (document.getElementById(panelId)) resetPanelToDefaults(panelId, shape);
        if (shape !== currentShape && modelsCache[shape]) {
            if (modelsCache[shape].parent) scene.remove(modelsCache[shape]);
            modelsCache[shape] = null;
            delete modelsCache[shape];
        }
    });
    const initPos = INITIAL_MODEL_COORDS[currentShape];
    if (currentModel && initPos) {
        currentModel.position.set(initPos.x, initPos.y, initPos.z);
        controls.target.copy(currentModel.position);
        const px = document.getElementById(`pos-x-${currentShape}`), py = document.getElementById(`pos-y-${currentShape}`), pz = document.getElementById(`pos-z-${currentShape}`);
        if (px) px.value = initPos.x;
        if (py) py.value = initPos.y;
        if (pz) pz.value = initPos.z;
    }
    syncCameraFromOffset();
    if (currentShape === 'plane') syncPlaneRotation();
}

// ========== 滑块绑定与面板拖动等 ==========
function bindSliderAndInput(sid,iid){ const s=document.getElementById(sid),i=document.getElementById(iid); if(!s||!i)return; const uf=()=>{ let v=parseFloat(i.value); if(isNaN(v))return; v=Math.min(parseFloat(s.max),Math.max(parseFloat(s.min),v)); s.value=v; const d=s.step.includes('.')?s.step.split('.')[1].length:0; i.value=v.toFixed(d); s.dispatchEvent(new Event('input')); }; i.addEventListener('change',uf); s.addEventListener('input',()=>{ const d=s.step.includes('.')?s.step.split('.')[1].length:0; i.value=parseFloat(s.value).toFixed(d); }); }
const sliderPairs=[['rx-slider','rx-input'],['ry-slider','ry-input'],['rz-slider','rz-input'],['radius-slider','radius-input'],['height-slider','height-input'],['cone-radius-slider','cone-radius-input'],['cone-height-slider','cone-height-input'],['top-radius-slider','top-radius-input'],['bottom-radius-slider','bottom-radius-input'],['frustum-height-slider','frustum-height-input'],['tube-radius-slider','tube-radius-input'],['ring-radius-slider','ring-radius-input'],['cube-width-slider','cube-width-input'],['cube-depth-slider','cube-depth-input'],['cube-height-slider','cube-height-input'],['pyramid-width-slider','pyramid-width-input'],['pyramid-depth-slider','pyramid-depth-input'],['pyramid-height-slider','pyramid-height-input'],['top-width-slider','top-width-input'],['top-depth-slider','top-depth-input'],['bottom-width-slider','bottom-width-input'],['bottom-depth-slider','bottom-depth-input'],['prism-height-slider','prism-height-input'],['plane-width-slider','plane-width-input'],['plane-height-slider','plane-height-input'],['outer-radius-slider','outer-radius-input'],['inner-radius-slider','inner-radius-input'],['pipe-length-slider','pipe-length-input'],['outer-width-slider','outer-width-input'],['outer-height-slider','outer-height-input'],['inner-width-slider','inner-width-input'],['inner-height-slider','inner-height-input'],['square-length-slider','square-length-input']];
sliderPairs.forEach(([s,i])=>bindSliderAndInput(s,i));
['rx-slider','ry-slider','rz-slider'].forEach(id=>{ const s=document.getElementById(id); if(s) s.addEventListener('input',()=>{ if(currentShape==='sphere'&&currentModel){ const rx=parseFloat(document.getElementById('rx-slider').value)||1,ry=parseFloat(document.getElementById('ry-slider').value)||1,rz=parseFloat(document.getElementById('rz-slider').value)||1; currentModel.scale.set(rx,ry,rz); } }); });
function bindShapeSliders(pid,sk){ const p=document.getElementById(pid); if(!p)return; p.querySelectorAll('.slider').forEach(s=>{ s.addEventListener('input',()=>{ if(currentShape===sk) updateModel(sk); }); }); }
['cylinder-settings-panel','cylinder','cone-settings-panel','cone','frustum-settings-panel','frustum_cone','torus-settings-panel','torus','cube-settings-panel','cube','pyramid-settings-panel','pyramid','plane-settings-panel','plane','pipe-settings-panel','pipe','square-tube-settings-panel','square_tube','prism-frustum-settings-panel','prism_frustum'].reduce((a,c,i,arr)=>{ if(i%2===0) bindShapeSliders(arr[i],arr[i+1]); },null);
document.querySelectorAll('.min-val, .max-val').forEach(el => el.remove());

// 面板拖动
const panelPositions=new Map(); let dragState=null;
function setPanelPosition(p,l,t){ p.style.left=l+'px'; p.style.top=t+'px'; }
function ensurePanelInitialPosition(p){ if(!panelPositions.has(p.id)){ const pw=p.offsetWidth,ph=p.offsetHeight; const l=Math.max(0,(window.innerWidth-pw)/2),t=Math.max(0,(window.innerHeight-ph)/2); panelPositions.set(p.id,{left:l,top:t}); } const pos=panelPositions.get(p.id); setPanelPosition(p,pos.left,pos.top); }
function startDrag(e,p){ if(e.target.closest('button')&&!e.target.closest('.settings-header'))return; if(e.target.closest('.settings-close')||e.target.closest('.settings-reset')||e.target.closest('.settings-toggle-vis')||e.target.closest('.global-reset-btn'))return; e.preventDefault(); const cx=e.touches?e.touches[0].clientX:e.clientX,cy=e.touches?e.touches[0].clientY:e.clientY; const r=p.getBoundingClientRect(); dragState={panel:p,startMouseX:cx,startMouseY:cy,startLeft:r.left,startTop:r.top,panelWidth:r.width,panelHeight:r.height}; p.querySelector('.settings-header')?.classList.add('dragging'); document.body.style.userSelect='none'; }
function onDragMove(e){ if(!dragState)return; e.preventDefault(); const cx=e.touches?e.touches[0].clientX:e.clientX,cy=e.touches?e.touches[0].clientY:e.clientY; let nl=dragState.startLeft+cx-dragState.startMouseX,nt=dragState.startTop+cy-dragState.startMouseY; setPanelPosition(dragState.panel,nl,nt); panelPositions.set(dragState.panel.id,{left:nl,top:nt}); }
function endDrag(){ if(!dragState)return; dragState.panel.querySelector('.settings-header')?.classList.remove('dragging'); document.body.style.userSelect=''; dragState=null; }
document.addEventListener('mousemove',onDragMove); document.addEventListener('mouseup',endDrag);
document.addEventListener('touchmove',onDragMove,{passive:false}); document.addEventListener('touchend',endDrag); document.addEventListener('touchcancel',endDrag);
document.querySelectorAll('.settings-panel,.texture-panel').forEach(p=>{ const h=p.querySelector('.settings-header'); if(h){ h.addEventListener('mousedown',e=>startDrag(e,p)); h.addEventListener('touchstart',e=>startDrag(e,p),{passive:false}); } });
['boolean-settings-panel','fractal-settings-panel','modifier-stack-panel'].forEach(id => {
    const panel = document.getElementById(id);
    if (panel) {
        const header = panel.querySelector('.settings-header');
        if (header) {
            header.addEventListener('mousedown', e => startDrag(e, panel));
            header.addEventListener('touchstart', e => startDrag(e, panel), { passive: false });
        }
    }
});

// 工具按钮映射与UI初始化（保留原有面板按钮功能，但不再使用左侧按钮组）
const closeAllPanels=()=>{ document.querySelectorAll('.settings-panel,.texture-panel').forEach(p=>p.classList.remove('visible')); };
document.querySelectorAll('.settings-reset').forEach(btn=>btn.addEventListener('click',()=>{ const panel=btn.closest('.settings-panel,.texture-panel'); if(!panel)return; const shape=btn.dataset.shape; if(shape){ resetPanelToDefaults(panel.id,shape); return; } const pt=btn.dataset.panel; if(!pt)return; switch(pt){ case'positioning':resetPositioning();break; case'lighting':resetLighting();break; case'material':resetMaterial();break; case'render':resetRender();break; case'texture':resetTexture();break; case'scene':resetScene();break; case'rotate':resetRotate();break; } }));
document.querySelectorAll('.settings-toggle-vis').forEach(btn => {
    btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        const panel = document.getElementById(panelId);
        if (panel) {
            const isTransparent = panel.classList.contains('transparent-mode');
            if (isTransparent) {
                panel.classList.remove('transparent-mode');
                btn.textContent = '显';
            } else {
                panel.classList.add('transparent-mode');
                btn.textContent = '隐';
            }
        }
    });
});
const closeBtnMappings={
    'positioning-close-btn':'positioning-settings-panel',
    'lighting-close-btn':'lighting-settings-panel',
    'material-close-btn':'material-settings-panel',
    'render-close-btn':'render-settings-panel',
    'scene-close-btn':'scene-settings-panel',
    'rotate-close-btn':'rotate-settings-panel',
    'boolean-close-btn':'boolean-settings-panel',
    'fractal-close-btn':'fractal-settings-panel',
    'modifier-stack-close-btn':'modifier-stack-panel'
};
Object.entries(closeBtnMappings).forEach(([bid,pid])=>{ document.getElementById(bid)?.addEventListener('click',()=>document.getElementById(pid)?.classList.remove('visible')); });
document.querySelectorAll('.settings-close').forEach(btn=>{ if(!Object.keys(closeBtnMappings).includes(btn.id)) btn.addEventListener('click',()=>btn.closest('.settings-panel')?.classList.remove('visible')); });

const positioningBtn = document.querySelector('.tool-btn[data-tool="positioning"]');
if (positioningBtn) positioningBtn.textContent = '相机';
const rotateBtn = document.querySelector('.tool-btn[data-tool="rotate"]');
if (rotateBtn) rotateBtn.remove();
const comboBtn = document.querySelector('.btn-bottom[data-category="combo"]');
if (comboBtn) comboBtn.textContent = '构建';

const toolMappings = {
    positioning: 'positioning-settings-panel',
    material: 'material-settings-panel',
    lighting: 'lighting-settings-panel',
    render: 'render-settings-panel',
    texture: 'texture-settings-panel'
};
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn=>btn.addEventListener('click',e=>{
    e.stopPropagation();
    const tool=btn.dataset.tool;
    if(tool==='texture'){
        const iv=texturePanel.classList.contains('visible');
        closeAllPanels();
        const textureToolBtn = document.getElementById('texture-tool-btn');
        if(iv){
            texturePanel.classList.remove('visible');
            if(textureToolBtn) textureToolBtn.classList.remove('texture-active');
        } else {
            texturePanel.classList.add('visible');
            if(textureToolBtn) textureToolBtn.classList.add('texture-active');
            ensurePanelInitialPosition(texturePanel);
            updateTexturePanelContent();
        }
        return;
    }
    const pid=toolMappings[tool];
    if(pid){
        const p=document.getElementById(pid);
        if(p){
            const iv=p.classList.contains('visible');
            closeAllPanels();
            if(iv) p.classList.remove('visible');
            else {
                p.classList.add('visible');
                ensurePanelInitialPosition(p);
                if(tool==='positioning') buildCameraPanel();
                if(tool==='material') { buildMaterialPanel(); refreshMaterialPanel(); }
                if(tool==='lighting') rebuildLightGUI();
                if(tool==='render') buildRenderPanel();
            }
        }
    }
}));

// 构建工具面板内部按钮事件（延迟初始化）
const buildToolsPanel = document.getElementById('build-tools-panel');
if (buildToolsPanel) {
    const buildBtns = buildToolsPanel.querySelectorAll('.tool-btn[data-build-tool]');
    buildBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.buildTool;
            const panelMap = {
                'boolean': 'boolean-settings-panel',
                'fractal': 'fractal-settings-panel',
                'modifier-stack': 'modifier-stack-panel'
            };
            const panelId = panelMap[tool];
            if (!panelId) return;
            const panel = document.getElementById(panelId);
            if (!panel) return;
            if (panel.classList.contains('visible')) {
                panel.classList.remove('visible');
            } else {
                closeAllPanels();
                panel.classList.add('visible');
                ensurePanelInitialPosition(panel);
                if (tool === 'boolean' && !panel.dataset.initialized) {
                    initBooleanPanelEvents();
                    panel.dataset.initialized = 'true';
                }
                if (tool === 'modifier-stack' && !panel.dataset.initialized) {
                    initModifierStackEvents();
                    panel.dataset.initialized = 'true';
                }
            }
        });
    });
}

// 交换材质和光照按钮顺序
(function swapMaterialLightButtons(){
    const container=document.getElementById('style-tools-panel');
    if(!container)return;
    const lightBtn=container.querySelector('[data-tool="lighting"]');
    const matBtn=container.querySelector('[data-tool="material"]');
    if(lightBtn&&matBtn&&lightBtn.nextSibling!==matBtn){
        container.insertBefore(matBtn,lightBtn);
    }
})();

// 移除形状面板中的网格控件
(function removeShapeGridControls(){
    const shapePanelIds=['sphere-settings-panel','cylinder-settings-panel','cone-settings-panel','frustum-settings-panel','torus-settings-panel','cube-settings-panel','pyramid-settings-panel','prism-frustum-settings-panel','plane-settings-panel','pipe-settings-panel','square-tube-settings-panel'];
    shapePanelIds.forEach(id=>{
        const panel=document.getElementById(id);
        if(panel){
            const gridControl=panel.querySelector('.grid-controls');
            if(gridControl) gridControl.remove();
        }
    });
})();

// 注入坐标与旋转控件
injectCoordAndRotateControls();

// ========== 启动 ==========
initVideoTextureControls();
setupGestureControls();
const initModel = createBasicSphere(); modelsCache['sphere'] = initModel; scene.add(initModel);
currentModel = initModel; currentShape = 'sphere';
const initCoords = INITIAL_MODEL_COORDS['sphere']; currentModel.position.set(initCoords.x, initCoords.y, initCoords.z);
controls.target.copy(currentModel.position); camera.position.set(initCoords.x + cameraOffset.x, initCoords.y + cameraOffset.y, initCoords.z + cameraOffset.z);
modelsMeta['sphere'] = getDefaultMeta(); loadMetaToUI('sphere');
const spherePanel2 = document.getElementById('sphere-settings-panel');
if (spherePanel2) {
    const px = spherePanel2.querySelector('#pos-x-sphere');
    const py = spherePanel2.querySelector('#pos-y-sphere');
    const pz = spherePanel2.querySelector('#pos-z-sphere');
    if(px) px.value = initCoords.x;
    if(py) py.value = initCoords.y;
    if(pz) pz.value = initCoords.z;
}
buildCameraPanel();

const clock = new THREE.Clock();

// ========== 动画循环 ==========
function animate() {
    requestAnimationFrame(animate);
    let delta = clock.getDelta();
    if (delta <= 0 || delta > 0.1) delta = 0.016;
    if (currentModel) {
        const pos = currentModel.position;
        gridHelper.position.x = pos.x; gridHelper.position.z = pos.z;
        groundMesh.position.x = pos.x; groundMesh.position.z = pos.z;
        targetPos.copy(pos);
        updateAllLightPositions();
    }
    updateVideoVisibility();
    for (const s in modelsCache) {
        const m = modelsCache[s];
        if (!m || !m.parent) continue;
        const meta = getMetaForShape(s);
        const rps = (sp) => (sp / 60) * 2 * Math.PI;
        if (meta.autoRotate.x) m.rotation.x += rps(meta.rotateSpeed.x) * delta * meta.rotateDir.x;
        if (meta.autoRotate.y) m.rotation.y += rps(meta.rotateSpeed.y) * delta * meta.rotateDir.y;
        if (meta.autoRotate.z) m.rotation.z += rps(meta.rotateSpeed.z) * delta * meta.rotateDir.z;
    }
    controls.update();
    composer.render();
}
animate();
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    updateFXAASize();
});
console.log('✅ 3D几何精粹 · 布尔升级版就绪');

// 暴露全局接口供外部HTML脚本使用
window.switchToShape = switchToShape;
window.currentShape = currentShape;
window.resetAllGeometry = resetAllGeometry;
