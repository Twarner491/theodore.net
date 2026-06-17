// src/distribute.ts
var adjacentsByCorner = {
  topLeft: [
    { corner: "topRight", side: "top" },
    { corner: "bottomLeft", side: "left" }
  ],
  topRight: [
    { corner: "topLeft", side: "top" },
    { corner: "bottomRight", side: "right" }
  ],
  bottomLeft: [
    { corner: "bottomRight", side: "bottom" },
    { corner: "topLeft", side: "left" }
  ],
  bottomRight: [
    { corner: "bottomLeft", side: "bottom" },
    { corner: "topRight", side: "right" }
  ]
};
function distributeAndNormalize({
  topLeftCornerRadius,
  topRightCornerRadius,
  bottomRightCornerRadius,
  bottomLeftCornerRadius,
  width,
  height
}) {
  const roundingAndSmoothingBudgetMap = {
    topLeft: -1,
    topRight: -1,
    bottomLeft: -1,
    bottomRight: -1
  };
  const cornerRadiusMap = {
    topLeft: topLeftCornerRadius,
    topRight: topRightCornerRadius,
    bottomLeft: bottomLeftCornerRadius,
    bottomRight: bottomRightCornerRadius
  };
  Object.entries(cornerRadiusMap).sort(([, r1], [, r2]) => r2 - r1).forEach(([corner, radius]) => {
    const adjacents = adjacentsByCorner[corner];
    const budget = Math.min(
      ...adjacents.map((adjacent) => {
        const adjacentCornerRadius = cornerRadiusMap[adjacent.corner];
        if (radius === 0 && adjacentCornerRadius === 0) {
          return 0;
        }
        const adjacentCornerBudget = roundingAndSmoothingBudgetMap[adjacent.corner];
        const sideLength = adjacent.side === "top" || adjacent.side === "bottom" ? width : height;
        if (adjacentCornerBudget >= 0) {
          return sideLength - adjacentCornerBudget;
        } else {
          return radius / (radius + adjacentCornerRadius) * sideLength;
        }
      })
    );
    roundingAndSmoothingBudgetMap[corner] = budget;
    cornerRadiusMap[corner] = Math.min(radius, budget);
  });
  const toCorner = (c) => ({
    radius: cornerRadiusMap[c],
    roundingAndSmoothingBudget: roundingAndSmoothingBudgetMap[c]
  });
  return {
    topLeft: toCorner("topLeft"),
    topRight: toCorner("topRight"),
    bottomLeft: toCorner("bottomLeft"),
    bottomRight: toCorner("bottomRight")
  };
}

// src/utils.ts
function toRadians(degrees) {
  return degrees * Math.PI / 180;
}
function rounded(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    out += typeof value === "number" ? value.toFixed(4) : value ?? "";
    out += strings[i + 1];
  }
  return out;
}

// src/curves/types.ts
var EMPTY_BUILDER_OUTPUT = {
  p: 0,
  pathSegment: () => ""
};

// src/curves/orient.ts
function transformX(X, Y, orient) {
  switch (orient) {
    case "TR":
      return X;
    case "BR":
      return -Y;
    case "BL":
      return -X;
    case "TL":
      return Y;
  }
}
function transformY(X, Y, orient) {
  switch (orient) {
    case "TR":
      return Y;
    case "BR":
      return X;
    case "BL":
      return -Y;
    case "TL":
      return -X;
  }
}

// src/curves/arc.ts
var buildArc = ({
  cornerRadius,
  roundingAndSmoothingBudget
}) => {
  const p = Math.min(cornerRadius, roundingAndSmoothingBudget);
  if (p <= 0) return EMPTY_BUILDER_OUTPUT;
  return {
    p,
    pathSegment: (orient) => {
      const dx = transformX(p, p, orient);
      const dy = transformY(p, p, orient);
      return rounded`a ${p} ${p} 0 0 1 ${dx} ${dy}`;
    }
  };
};

// src/corner-params.ts
function getPathParamsForCorner({
  cornerRadius,
  cornerSmoothing,
  preserveSmoothing,
  roundingAndSmoothingBudget
}) {
  if (cornerRadius <= 0) {
    return { a: 0, b: 0, c: 0, d: 0, p: 0, arcSectionLength: 0, cornerRadius: 0 };
  }
  let p = (1 + cornerSmoothing) * cornerRadius;
  if (!preserveSmoothing) {
    const maxCornerSmoothing = roundingAndSmoothingBudget / cornerRadius - 1;
    cornerSmoothing = Math.min(cornerSmoothing, maxCornerSmoothing);
    p = Math.min(p, roundingAndSmoothingBudget);
  }
  const arcMeasure = 90 * (1 - cornerSmoothing);
  const arcSectionLength = Math.sin(toRadians(arcMeasure / 2)) * cornerRadius * Math.sqrt(2);
  const angleAlpha = (90 - arcMeasure) / 2;
  const p3ToP4Distance = cornerRadius * Math.tan(toRadians(angleAlpha / 2));
  const angleBeta = 45 * cornerSmoothing;
  const c = p3ToP4Distance * Math.cos(toRadians(angleBeta));
  const d = c * Math.tan(toRadians(angleBeta));
  let b = (p - arcSectionLength - c - d) / 3;
  let a = 2 * b;
  if (preserveSmoothing && p > roundingAndSmoothingBudget) {
    const p1ToP3MaxDistance = roundingAndSmoothingBudget - d - arcSectionLength - c;
    const minA = p1ToP3MaxDistance / 6;
    const maxB = p1ToP3MaxDistance - minA;
    b = Math.min(b, maxB);
    a = p1ToP3MaxDistance - b;
    p = Math.min(p, roundingAndSmoothingBudget);
  }
  return { a, b, c, d, p, arcSectionLength, cornerRadius };
}

// src/curves/squircle.ts
var buildSquircle = ({
  cornerRadius,
  smoothing,
  preserveSmoothing,
  roundingAndSmoothingBudget
}) => {
  const params = getPathParamsForCorner({
    cornerRadius,
    cornerSmoothing: smoothing,
    preserveSmoothing,
    roundingAndSmoothingBudget
  });
  if (params.cornerRadius <= 0) return EMPTY_BUILDER_OUTPUT;
  return {
    p: params.p,
    pathSegment: (orient) => {
      switch (orient) {
        case "TR":
          return drawTopRightPath(params);
        case "BR":
          return drawBottomRightPath(params);
        case "BL":
          return drawBottomLeftPath(params);
        case "TL":
          return drawTopLeftPath(params);
      }
    }
  };
};
function drawTopRightPath({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  return rounded`c ${a} 0 ${a + b} 0 ${a + b + c} ${d} a ${cornerRadius} ${cornerRadius} 0 0 1 ${arcSectionLength} ${arcSectionLength} c ${d} ${c} ${d} ${b + c} ${d} ${a + b + c}`;
}
function drawBottomRightPath({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  return rounded`c 0 ${a} 0 ${a + b} ${-d} ${a + b + c} a ${cornerRadius} ${cornerRadius} 0 0 1 -${arcSectionLength} ${arcSectionLength} c ${-c} ${d} ${-(b + c)} ${d} ${-(a + b + c)} ${d}`;
}
function drawBottomLeftPath({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  return rounded`c ${-a} 0 ${-(a + b)} 0 ${-(a + b + c)} ${-d} a ${cornerRadius} ${cornerRadius} 0 0 1 -${arcSectionLength} -${arcSectionLength} c ${-d} ${-c} ${-d} ${-(b + c)} ${-d} ${-(a + b + c)}`;
}
function drawTopLeftPath({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  return rounded`c 0 ${-a} 0 ${-(a + b)} ${d} ${-(a + b + c)} a ${cornerRadius} ${cornerRadius} 0 0 1 ${arcSectionLength} -${arcSectionLength} c ${c} ${-d} ${b + c} ${-d} ${a + b + c} ${-d}`;
}

// src/curves/superellipse.ts
var buildSuperellipse = ({
  cornerRadius,
  exponent,
  roundingAndSmoothingBudget
}) => {
  const p = Math.min(cornerRadius, roundingAndSmoothingBudget);
  if (p <= 0) return EMPTY_BUILDER_OUTPUT;
  const n = Number.isFinite(exponent) ? Math.max(2, exponent) : 4;
  const e = 2 / n;
  const powE = n === 2 ? (x) => x : n === 4 ? Math.sqrt : n === 8 ? (x) => Math.sqrt(Math.sqrt(x)) : (x) => Math.pow(x, e);
  const e1 = e - 1;
  const powE1 = n === 2 ? () => 1 : n === 4 ? (x) => 1 / Math.sqrt(x) : (x) => Math.pow(x, e1);
  const thetas = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2];
  const points = thetas.map((th, i) => {
    if (i === 0) return [0, 0];
    if (i === thetas.length - 1) return [p, p];
    const sinTh = Math.sin(th);
    const cosTh = Math.cos(th);
    return [p * powE(sinTh), p * (1 - powE(cosTh))];
  });
  const tangents = thetas.map((th, i) => {
    if (i === 0) return [1, 0];
    if (i === thetas.length - 1) return [0, 1];
    const sinTh = Math.sin(th);
    const cosTh = Math.cos(th);
    const dX = e * powE1(sinTh) * cosTh * p;
    const dY = e * powE1(cosTh) * sinTh * p;
    const m = Math.hypot(dX, dY) || 1;
    return [dX / m, dY / m];
  });
  return {
    p,
    pathSegment: (orient) => {
      const parts = [];
      for (let i = 0; i < thetas.length - 1; i++) {
        const [X0, Y0] = points[i];
        const [X1, Y1] = points[i + 1];
        const [T0x, T0y] = tangents[i];
        const [T1x, T1y] = tangents[i + 1];
        const thMid = (thetas[i] + thetas[i + 1]) / 2;
        const sinM = Math.sin(thMid);
        const cosM = Math.cos(thMid);
        const Mx = p * powE(sinM);
        const My = p * (1 - powE(cosM));
        const RHSx = 8 / 3 * (Mx - (X0 + X1) / 2);
        const RHSy = 8 / 3 * (My - (Y0 + Y1) / 2);
        const det = T1x * T0y - T1y * T0x;
        const h0 = det !== 0 ? (-T1y * RHSx + T1x * RHSy) / det : 0;
        const h1 = det !== 0 ? (T0x * RHSy - T0y * RHSx) / det : 0;
        const B1x = X0 + h0 * T0x;
        const B1y = Y0 + h0 * T0y;
        const B2x = X1 - h1 * T1x;
        const B2y = Y1 - h1 * T1y;
        const dB1x = B1x - X0;
        const dB1y = B1y - Y0;
        const dB2x = B2x - X0;
        const dB2y = B2y - Y0;
        const dB3x = X1 - X0;
        const dB3y = Y1 - Y0;
        const dx1 = transformX(dB1x, dB1y, orient);
        const dy1 = transformY(dB1x, dB1y, orient);
        const dx2 = transformX(dB2x, dB2y, orient);
        const dy2 = transformY(dB2x, dB2y, orient);
        const dx3 = transformX(dB3x, dB3y, orient);
        const dy3 = transformY(dB3x, dB3y, orient);
        parts.push(rounded`c ${dx1} ${dy1} ${dx2} ${dy2} ${dx3} ${dy3}`);
      }
      return parts.join(" ");
    }
  };
};

// src/curves/integrate.ts
function integrateClothoid(theta0, kappa0, A, L) {
  const N = 32;
  if (L <= 0) return { x: 0, y: 0, theta: theta0 };
  const step = L / N;
  let xAcc = 0;
  let yAcc = 0;
  for (let i = 1; i <= N; i++) {
    const sA = (i - 1) * step;
    const sB = sA + step;
    const sM = (sA + sB) / 2;
    const thA = theta0 + kappa0 * sA + A / 2 * sA * sA;
    const thB = theta0 + kappa0 * sB + A / 2 * sB * sB;
    const thM = theta0 + kappa0 * sM + A / 2 * sM * sM;
    xAcc += step / 6 * (Math.cos(thA) + 4 * Math.cos(thM) + Math.cos(thB));
    yAcc += step / 6 * (Math.sin(thA) + 4 * Math.sin(thM) + Math.sin(thB));
  }
  const thetaEnd = theta0 + kappa0 * L + A / 2 * L * L;
  return { x: xAcc, y: yAcc, theta: thetaEnd };
}

// src/curves/clothoid.ts
var ANGLE_EPSILON = 1e-6;
var buildClothoid = ({
  cornerRadius,
  smoothing,
  roundingAndSmoothingBudget
}) => {
  if (cornerRadius <= 0) return EMPTY_BUILDER_OUTPUT;
  const s = Math.max(0, Math.min(1, smoothing));
  const R = cornerRadius;
  const dTheta = Math.PI / 4 * s;
  const L = Math.PI / 2 * R * s;
  const A = L > 0 ? 1 / (R * L) : 0;
  const { x: xC, y: yC } = L > 0 ? integrateClothoid(0, 0, A, L) : { x: 0, y: 0 };
  const { x: xMid, y: yMid } = L > 0 ? integrateClothoid(0, 0, A, L / 2) : { x: 0, y: 0 };
  const arcCx = xC - R * Math.sin(dTheta);
  const arcCy = yC + R * Math.cos(dTheta);
  const naturalP = arcCx + arcCy;
  let p = naturalP;
  let effR = R;
  let effX = xC;
  let effY = yC;
  let effMx = xMid;
  let effMy = yMid;
  if (naturalP > roundingAndSmoothingBudget && naturalP > 0) {
    const scale = roundingAndSmoothingBudget / naturalP;
    p = roundingAndSmoothingBudget;
    effR = R * scale;
    effX = xC * scale;
    effY = yC * scale;
    effMx = xMid * scale;
    effMy = yMid * scale;
  }
  if (p <= 0) {
    return EMPTY_BUILDER_OUTPUT;
  }
  let h0 = 0;
  let h1 = 0;
  if (L > 0) {
    const cosDt = Math.cos(dTheta);
    const sinDt = Math.sin(dTheta);
    if (sinDt > 1e-12) {
      h1 = 8 / 3 * (effY / 2 - effMy) / sinDt;
    }
    h0 = 8 / 3 * (effMx - effX / 2) + h1 * cosDt;
  }
  const arcSweep = Math.PI / 2 - 2 * dTheta;
  const hasArc = Math.abs(arcSweep) > ANGLE_EPSILON;
  return {
    p,
    pathSegment: (orient) => {
      const parts = [];
      if (L > 0) {
        const B1dx = h0;
        const B1dy = 0;
        const B2dx = effX - h1 * Math.cos(dTheta);
        const B2dy = effY - h1 * Math.sin(dTheta);
        const B3dx = effX;
        const B3dy = effY;
        const a = transformX(B1dx, B1dy, orient);
        const b = transformY(B1dx, B1dy, orient);
        const c = transformX(B2dx, B2dy, orient);
        const d = transformY(B2dx, B2dy, orient);
        const e = transformX(B3dx, B3dy, orient);
        const f = transformY(B3dx, B3dy, orient);
        parts.push(rounded`c ${a} ${b} ${c} ${d} ${e} ${f}`);
      }
      if (hasArc) {
        const arcDx = p - effX - effY;
        const arcDy = p - effX - effY;
        const ax = transformX(arcDx, arcDy, orient);
        const ay = transformY(arcDx, arcDy, orient);
        parts.push(rounded`a ${effR} ${effR} 0 0 1 ${ax} ${ay}`);
      }
      if (L > 0) {
        const B1dx = h1 * Math.sin(dTheta);
        const B1dy = h1 * Math.cos(dTheta);
        const B2dx = effY;
        const B2dy = effX - h0;
        const B3dx = effY;
        const B3dy = effX;
        const a = transformX(B1dx, B1dy, orient);
        const b = transformY(B1dx, B1dy, orient);
        const c = transformX(B2dx, B2dy, orient);
        const d = transformY(B2dx, B2dy, orient);
        const e = transformX(B3dx, B3dy, orient);
        const f = transformY(B3dx, B3dy, orient);
        parts.push(rounded`c ${a} ${b} ${c} ${d} ${e} ${f}`);
      }
      return parts.join(" ");
    }
  };
};

// src/curves/index.ts
var DEFAULT_EXPONENT = 4;
var CURVE_BUILDERS = {
  arc: buildArc,
  squircle: buildSquircle,
  superellipse: buildSuperellipse,
  clothoid: buildClothoid
};
var CURVE_TYPES = Object.keys(CURVE_BUILDERS);
function getCurveBuilder(type) {
  return CURVE_BUILDERS[type];
}

// src/curves/cache.ts
var CAPACITY = 64;
var cache = /* @__PURE__ */ new Map();
function key(curve, input) {
  return curve + "|" + input.cornerRadius + "|" + input.smoothing + "|" + input.exponent + "|" + (input.preserveSmoothing ? 1 : 0) + "|" + input.roundingAndSmoothingBudget;
}
function hasNonFiniteKeyField(input) {
  return !Number.isFinite(input.cornerRadius) || !Number.isFinite(input.smoothing) || !Number.isFinite(input.exponent) || !Number.isFinite(input.roundingAndSmoothingBudget);
}
function wrapWithOrientCache(fresh) {
  const orients = {};
  return {
    p: fresh.p,
    pathSegment: (orient) => {
      const cached = orients[orient];
      if (cached !== void 0) return cached;
      const s = fresh.pathSegment(orient);
      orients[orient] = s;
      return s;
    }
  };
}
function getCachedBuilderOutput(curve, builder, input) {
  if (hasNonFiniteKeyField(input)) return builder(input);
  const k = key(curve, input);
  const cached = cache.get(k);
  if (cached) {
    cache.delete(k);
    cache.set(k, cached);
    return cached;
  }
  const fresh = wrapWithOrientCache(builder(input));
  if (cache.size >= CAPACITY) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== void 0) cache.delete(firstKey);
  }
  cache.set(k, fresh);
  return fresh;
}
function clearCurveCache() {
  cache.clear();
}

// src/generate-path.ts
var DEFAULT_SMOOTHING = 0.6;
var DEFAULT_PRESERVE_SMOOTHING = true;
var DEFAULT_CURVE = "squircle";
function withDefaults(c) {
  return {
    radius: c.radius,
    curve: c.curve ?? DEFAULT_CURVE,
    smoothing: c.smoothing ?? DEFAULT_SMOOTHING,
    exponent: c.exponent ?? DEFAULT_EXPONENT,
    preserveSmoothing: c.preserveSmoothing ?? DEFAULT_PRESERVE_SMOOTHING
  };
}
function resolve(v) {
  const c = typeof v === "number" ? { radius: v } : v ?? { radius: 0 };
  return withDefaults(c);
}
function resolveOptions(options) {
  if ("radius" in options) {
    const c = withDefaults(options);
    return { topLeft: c, topRight: c, bottomRight: c, bottomLeft: c };
  }
  return {
    topLeft: resolve(options.topLeft),
    topRight: resolve(options.topRight),
    bottomRight: resolve(options.bottomRight),
    bottomLeft: resolve(options.bottomLeft)
  };
}
function generatePath(width, height, options) {
  if (width <= 0 || height <= 0) {
    return "M 0 0 H 0 V 0 H 0 Z";
  }
  const corners = resolveOptions(options);
  if (corners.topLeft.radius <= 0 && corners.topRight.radius <= 0 && corners.bottomRight.radius <= 0 && corners.bottomLeft.radius <= 0) {
    return `M 0 0 H ${width} V ${height} H 0 Z`;
  }
  const normalized = distributeAndNormalize({
    topLeftCornerRadius: corners.topLeft.radius,
    topRightCornerRadius: corners.topRight.radius,
    bottomRightCornerRadius: corners.bottomRight.radius,
    bottomLeftCornerRadius: corners.bottomLeft.radius,
    width,
    height
  });
  const builderOutFor = (name) => {
    const corner = corners[name];
    const builder = getCurveBuilder(corner.curve);
    return getCachedBuilderOutput(corner.curve, builder, {
      cornerRadius: normalized[name].radius,
      smoothing: corner.smoothing,
      exponent: corner.exponent,
      preserveSmoothing: corner.preserveSmoothing,
      roundingAndSmoothingBudget: normalized[name].roundingAndSmoothingBudget
    });
  };
  const tl = builderOutFor("topLeft");
  const tr = builderOutFor("topRight");
  const br = builderOutFor("bottomRight");
  const bl = builderOutFor("bottomLeft");
  const r = (n) => n.toFixed(4);
  const seg = (s) => s.length > 0 ? " " + s : "";
  return "M " + r(tl.p) + " 0 L " + r(width - tr.p) + " 0" + seg(tr.pathSegment("TR")) + " L " + r(width) + " " + r(br.p) + " L " + r(width) + " " + r(height - br.p) + seg(br.pathSegment("BR")) + " L " + r(width - bl.p) + " " + r(height) + " L " + r(bl.p) + " " + r(height) + seg(bl.pathSegment("BL")) + " L 0 " + r(height - tl.p) + " L 0 " + r(tl.p) + seg(tl.pathSegment("TL")) + " Z";
}
function generateClipPath(width, height, options) {
  return `path("${generatePath(width, height, options)}")`;
}

// src/draw.ts
function getSVGPathFromPathParams({
  width,
  height,
  topLeftPathParams,
  topRightPathParams,
  bottomLeftPathParams,
  bottomRightPathParams
}) {
  const r = (n) => n.toFixed(4);
  return `
    M ${r(topLeftPathParams.p)} 0
    L ${r(width - topRightPathParams.p)} 0
    ${drawTopRightPath2(topRightPathParams)}
    L ${r(width)} ${r(bottomRightPathParams.p)}
    L ${r(width)} ${r(height - bottomRightPathParams.p)}
    ${drawBottomRightPath2(bottomRightPathParams)}
    L ${r(width - bottomLeftPathParams.p)} ${r(height)}
    L ${r(bottomLeftPathParams.p)} ${r(height)}
    ${drawBottomLeftPath2(bottomLeftPathParams)}
    L 0 ${r(height - topLeftPathParams.p)}
    L 0 ${r(topLeftPathParams.p)}
    ${drawTopLeftPath2(topLeftPathParams)}
    Z
  `.replace(/[\t\s\n]+/g, " ").trim();
}
function drawTopRightPath2({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  if (cornerRadius) {
    return rounded`
    c ${a} 0 ${a + b} 0 ${a + b + c} ${d}
    a ${cornerRadius} ${cornerRadius} 0 0 1 ${arcSectionLength} ${arcSectionLength}
    c ${d} ${c}
        ${d} ${b + c}
        ${d} ${a + b + c}`;
  }
  return "";
}
function drawBottomRightPath2({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  if (cornerRadius) {
    return rounded`
    c 0 ${a}
      0 ${a + b}
      ${-d} ${a + b + c}
    a ${cornerRadius} ${cornerRadius} 0 0 1 -${arcSectionLength} ${arcSectionLength}
    c ${-c} ${d}
      ${-(b + c)} ${d}
      ${-(a + b + c)} ${d}`;
  }
  return "";
}
function drawBottomLeftPath2({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  if (cornerRadius) {
    return rounded`
    c ${-a} 0
      ${-(a + b)} 0
      ${-(a + b + c)} ${-d}
    a ${cornerRadius} ${cornerRadius} 0 0 1 -${arcSectionLength} -${arcSectionLength}
    c ${-d} ${-c}
      ${-d} ${-(b + c)}
      ${-d} ${-(a + b + c)}`;
  }
  return "";
}
function drawTopLeftPath2({
  cornerRadius,
  a,
  b,
  c,
  d,
  arcSectionLength
}) {
  if (cornerRadius) {
    return rounded`
    c 0 ${-a}
      0 ${-(a + b)}
      ${d} ${-(a + b + c)}
    a ${cornerRadius} ${cornerRadius} 0 0 1 ${arcSectionLength} -${arcSectionLength}
    c ${c} ${-d}
      ${b + c} ${-d}
      ${a + b + c} ${-d}`;
  }
  return "";
}

// src/svg-shared.ts
var SVG_NS = "http://www.w3.org/2000/svg";
var uid = 0;
function nextUid() {
  return ++uid;
}
function expandHex(hex) {
  const h = hex.replace("#", "");
  if (h.length === 3) return "#" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return "#" + h;
}
function hexToRgb(hex) {
  const h = expandHex(hex).replace("#", "");
  return `rgb(${parseInt(h.substring(0, 2), 16)},${parseInt(h.substring(2, 4), 16)},${parseInt(h.substring(4, 6), 16)})`;
}
var DEFAULT_SHADOW = {
  offsetX: 0,
  offsetY: 0,
  blur: 0,
  spread: 0,
  color: "#000",
  opacity: 0
};
function createPathCache(options) {
  const cache2 = /* @__PURE__ */ new Map();
  const optionsKey = JSON.stringify(options);
  return (w, h, opts, spread) => {
    const key2 = `${w}:${h}:${spread}:${optionsKey}`;
    let cached = cache2.get(key2);
    if (cached === void 0) {
      cached = generatePath(w, h, opts);
      cache2.set(key2, cached);
    }
    return cached;
  };
}
function adjustOptions(options, spread) {
  if (spread === 0) return options;
  if ("radius" in options) {
    return { ...options, radius: Math.max(0, options.radius + spread) };
  }
  const adjust = (v) => {
    if (v === void 0) return void 0;
    if (typeof v === "number") return Math.max(0, v + spread);
    return { ...v, radius: Math.max(0, v.radius + spread) };
  };
  return {
    topLeft: adjust(options.topLeft),
    topRight: adjust(options.topRight),
    bottomRight: adjust(options.bottomRight),
    bottomLeft: adjust(options.bottomLeft)
  };
}
function darkenHex(hex) {
  const h = expandHex(hex).replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (r === 0 && g === 0 && b === 0) return "#4c4c4c";
  const dr = Math.round(r * 2 / 3);
  const dg = Math.round(g * 2 / 3);
  const db = Math.round(b * 2 / 3);
  return "#" + (1 << 24 | dr << 16 | dg << 8 | db).toString(16).slice(1);
}
function isGradient(color) {
  return typeof color === "object" && color !== null && "type" in color;
}
function angleToCoords(angleDeg) {
  const rad = (90 - angleDeg) * Math.PI / 180;
  return {
    x1: 0.5 - 0.5 * Math.cos(rad),
    y1: 0.5 + 0.5 * Math.sin(rad),
    x2: 0.5 + 0.5 * Math.cos(rad),
    y2: 0.5 - 0.5 * Math.sin(rad)
  };
}
function applyStops(gradientEl, stops) {
  while (gradientEl.lastChild) gradientEl.removeChild(gradientEl.lastChild);
  for (const s of stops) {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", String(s.offset));
    stop.setAttribute("stop-color", s.color);
    if (s.opacity !== void 0 && s.opacity !== 1) {
      stop.setAttribute("stop-opacity", String(s.opacity));
    }
    gradientEl.appendChild(stop);
  }
}
function createGradientDef(defs, config, id) {
  const tag = config.type === "linear" ? "linearGradient" : "radialGradient";
  const el = document.createElementNS(SVG_NS, tag);
  el.setAttribute("id", id);
  setGradientAttrs(el, config);
  applyStops(el, config.stops);
  defs.appendChild(el);
  return el;
}
function updateGradientDef(gradientEl, config) {
  setGradientAttrs(gradientEl, config);
  applyStops(gradientEl, config.stops);
}
function setGradientAttrs(el, config) {
  if (config.type === "linear") {
    const coords = angleToCoords(config.angle ?? 0);
    el.setAttribute("x1", String(coords.x1));
    el.setAttribute("y1", String(coords.y1));
    el.setAttribute("x2", String(coords.x2));
    el.setAttribute("y2", String(coords.y2));
  } else {
    el.setAttribute("cx", String(config.cx ?? 0.5));
    el.setAttribute("cy", String(config.cy ?? 0.5));
    el.setAttribute("r", String(config.r ?? 0.5));
  }
}
function darkenGradient(config) {
  return { ...config, stops: config.stops.map((s) => ({ ...s, color: darkenHex(s.color) })) };
}

export {
  distributeAndNormalize,
  toRadians,
  rounded,
  buildArc,
  getPathParamsForCorner,
  buildSquircle,
  buildSuperellipse,
  buildClothoid,
  DEFAULT_EXPONENT,
  CURVE_TYPES,
  getCurveBuilder,
  clearCurveCache,
  DEFAULT_SMOOTHING,
  DEFAULT_PRESERVE_SMOOTHING,
  DEFAULT_CURVE,
  generatePath,
  generateClipPath,
  getSVGPathFromPathParams,
  SVG_NS,
  nextUid,
  hexToRgb,
  DEFAULT_SHADOW,
  createPathCache,
  adjustOptions,
  darkenHex,
  isGradient,
  createGradientDef,
  updateGradientDef,
  darkenGradient
};
//# sourceMappingURL=chunk-Y36QMVHN.js.map