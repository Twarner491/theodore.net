import {
  CURVE_TYPES,
  DEFAULT_CURVE,
  DEFAULT_EXPONENT,
  DEFAULT_PRESERVE_SMOOTHING,
  DEFAULT_SHADOW,
  DEFAULT_SMOOTHING,
  SVG_NS,
  adjustOptions,
  buildArc,
  buildClothoid,
  buildSquircle,
  buildSuperellipse,
  clearCurveCache,
  createGradientDef,
  createPathCache,
  darkenGradient,
  darkenHex,
  distributeAndNormalize,
  generateClipPath,
  generatePath,
  getCurveBuilder,
  getPathParamsForCorner,
  getSVGPathFromPathParams,
  hexToRgb,
  isGradient,
  nextUid,
  rounded,
  toRadians,
  updateGradientDef
} from "./chunk-Y36QMVHN.js";

// src/svg-effects.ts
function padBounds(el, pad, w, h) {
  el.setAttribute("x", String(-pad));
  el.setAttribute("y", String(-pad));
  el.setAttribute("width", String(w + pad * 2));
  el.setAttribute("height", String(h + pad * 2));
}
function padMaskAndRect(mask, rect, pad, w, h) {
  padBounds(mask, pad, w, h);
  padBounds(rect, pad, w, h);
}
function createKnockoutMask(maskId, defs, userSpaceOnUse) {
  const mask = document.createElementNS(SVG_NS, "mask");
  mask.setAttribute("id", maskId);
  if (userSpaceOnUse) mask.setAttribute("maskUnits", "userSpaceOnUse");
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("fill", "white");
  const knockout = document.createElementNS(SVG_NS, "path");
  knockout.setAttribute("fill", "none");
  knockout.setAttribute("stroke", "black");
  mask.appendChild(rect);
  mask.appendChild(knockout);
  defs.appendChild(mask);
  return { mask, rect, knockout };
}
function createStrokeGroup(clipOrMask) {
  const group = document.createElementNS(SVG_NS, "g");
  const strokePath = document.createElementNS(SVG_NS, "path");
  strokePath.setAttribute("fill", "none");
  if (clipOrMask) strokePath.setAttribute(clipOrMask.attr, clipOrMask.value);
  strokePath.style.display = "none";
  group.appendChild(strokePath);
  const grooveOverlay = document.createElementNS(SVG_NS, "path");
  grooveOverlay.setAttribute("fill", "none");
  if (clipOrMask) grooveOverlay.setAttribute(clipOrMask.attr, clipOrMask.value);
  grooveOverlay.style.display = "none";
  group.appendChild(grooveOverlay);
  return { group, strokePath, grooveOverlay };
}
function removeGradient(els, which) {
  const key = which === "main" ? "gradientEl" : "overlayGradientEl";
  els[key]?.remove();
  els[key] = null;
}
function resolveStroke(color, els, which) {
  if (!isGradient(color)) {
    removeGradient(els, which);
    return color;
  }
  const elKey = which === "main" ? "gradientEl" : "overlayGradientEl";
  const id = which === "main" ? els.gradientId : els.overlayGradientId;
  if (els[elKey]) {
    updateGradientDef(els[elKey], color);
  } else {
    els[elKey] = createGradientDef(els.defs, color, id);
  }
  return `url(#${id})`;
}
function updateBorder(config, d, width, height, els) {
  if (!config || config.width <= 0 || config.opacity <= 0) {
    els.strokePath.style.display = "none";
    els.strokeGroup.removeAttribute("mask");
    els.grooveOverlay.style.display = "none";
    removeGradient(els, "main");
    removeGradient(els, "overlay");
    return;
  }
  const m = els.strokeMultiplier;
  els.strokePath.style.display = "";
  els.strokePath.setAttribute("d", d);
  els.strokePath.setAttribute("stroke", resolveStroke(config.color, els, "main"));
  els.strokePath.setAttribute("stroke-width", String(config.width * m));
  els.strokePath.setAttribute("stroke-opacity", String(config.opacity));
  const style = config.style ?? "solid";
  els.strokeGroup.removeAttribute("mask");
  els.grooveOverlay.style.display = "none";
  els.strokePath.removeAttribute("stroke-dasharray");
  els.strokePath.setAttribute("stroke-linecap", "butt");
  if (style !== "groove" && style !== "ridge") {
    removeGradient(els, "overlay");
  }
  switch (style) {
    case "dashed": {
      const dashLen = Math.max(0, config.dash ?? config.width * 3);
      const gapLen = Math.max(0, config.gap ?? config.width * 2);
      els.strokePath.setAttribute("stroke-dasharray", `${dashLen} ${gapLen}`);
      if (config.lineCap) els.strokePath.setAttribute("stroke-linecap", config.lineCap);
      break;
    }
    case "dotted": {
      const dotDash = Math.max(0, config.dash ?? 0);
      const dotGap = Math.max(0, config.gap ?? config.width * 2);
      els.strokePath.setAttribute("stroke-dasharray", `${dotDash} ${dotGap}`);
      els.strokePath.setAttribute("stroke-linecap", config.lineCap ?? "round");
      break;
    }
    case "double":
      if (config.width >= 3) {
        const third = Math.round(config.width / 3);
        els.dblKnockout.setAttribute("d", d);
        els.dblKnockout.setAttribute("stroke-width", String(third * m));
        els.dblRect.setAttribute("width", String(width));
        els.dblRect.setAttribute("height", String(height));
        if (els.padDblMask) els.padDblMask(config.width, width, height);
        els.strokeGroup.setAttribute("mask", `url(#${els.dblMaskId})`);
      }
      break;
    case "groove": {
      const grooveBase = isGradient(config.color) ? darkenGradient(config.color) : darkenHex(config.color);
      els.strokePath.setAttribute("stroke", resolveStroke(grooveBase, els, "main"));
      els.grooveOverlay.style.display = "";
      els.grooveOverlay.setAttribute("d", d);
      els.grooveOverlay.setAttribute("stroke", resolveStroke(config.color, els, "overlay"));
      els.grooveOverlay.setAttribute("stroke-width", String(config.width * m / 2));
      els.grooveOverlay.setAttribute("stroke-opacity", String(config.opacity));
      break;
    }
    case "ridge": {
      const ridgeDark = isGradient(config.color) ? darkenGradient(config.color) : darkenHex(config.color);
      els.grooveOverlay.style.display = "";
      els.grooveOverlay.setAttribute("d", d);
      els.grooveOverlay.setAttribute("stroke", resolveStroke(ridgeDark, els, "overlay"));
      els.grooveOverlay.setAttribute("stroke-width", String(config.width * m / 2));
      els.grooveOverlay.setAttribute("stroke-opacity", String(config.opacity));
      break;
    }
  }
}
function createInnerShadowEntry(defs, clipGroup) {
  const uid = nextUid();
  const maskId = `sc-ishadow-mask-${uid}`;
  const mask = document.createElementNS(SVG_NS, "mask");
  mask.setAttribute("id", maskId);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  const maskRect = document.createElementNS(SVG_NS, "rect");
  maskRect.setAttribute("fill", "white");
  const maskCutout = document.createElementNS(SVG_NS, "path");
  maskCutout.setAttribute("fill", "black");
  mask.appendChild(maskRect);
  mask.appendChild(maskCutout);
  defs.appendChild(mask);
  const filterId = `sc-ishadow-blur-${uid}`;
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "-200%");
  filter.setAttribute("y", "-200%");
  filter.setAttribute("width", "500%");
  filter.setAttribute("height", "500%");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", "0");
  filter.appendChild(feBlur);
  defs.appendChild(filter);
  const blurGroup = document.createElementNS(SVG_NS, "g");
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("mask", `url(#${maskId})`);
  rect.style.display = "none";
  blurGroup.appendChild(rect);
  clipGroup.appendChild(blurGroup);
  return { maskId, mask, maskRect, maskCutout, filterId, filter, feBlur, blurGroup, rect };
}
function removeInnerShadowEntry(entry) {
  entry.mask.remove();
  entry.filter.remove();
  entry.blurGroup.remove();
}
function createSvgEffects(anchor) {
  const id = nextUid();
  const clipId = `sc-clip-${id}`;
  const maskId = `sc-mask-${id}`;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";
  svg.style.overflow = "visible";
  svg.style.zIndex = "1";
  svg.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG_NS, "defs");
  const clipPathEl = document.createElementNS(SVG_NS, "clipPath");
  clipPathEl.setAttribute("id", clipId);
  const clipShape = document.createElementNS(SVG_NS, "path");
  clipPathEl.appendChild(clipShape);
  defs.appendChild(clipPathEl);
  const maskEl = document.createElementNS(SVG_NS, "mask");
  maskEl.setAttribute("id", maskId);
  maskEl.setAttribute("maskUnits", "userSpaceOnUse");
  const maskRect = document.createElementNS(SVG_NS, "rect");
  maskRect.setAttribute("fill", "white");
  const maskShape = document.createElementNS(SVG_NS, "path");
  maskShape.setAttribute("fill", "black");
  maskEl.appendChild(maskRect);
  maskEl.appendChild(maskShape);
  defs.appendChild(maskEl);
  const innerDblMaskId = `sc-dbl-inner-${id}`;
  const { rect: innerDblRect, knockout: innerDblKnockout } = createKnockoutMask(innerDblMaskId, defs, false);
  const outerDblMaskId = `sc-dbl-outer-${id}`;
  const { mask: outerDblMask, rect: outerDblRect, knockout: outerDblKnockout } = createKnockoutMask(outerDblMaskId, defs, true);
  const middleDblMaskId = `sc-dbl-middle-${id}`;
  const { mask: middleDblMask, rect: middleDblRect, knockout: middleDblKnockout } = createKnockoutMask(middleDblMaskId, defs, true);
  svg.appendChild(defs);
  const isShadowClip = document.createElementNS(SVG_NS, "g");
  isShadowClip.setAttribute("clip-path", `url(#${clipId})`);
  svg.appendChild(isShadowClip);
  const innerShadowPool = [];
  const { group: innerStrokeGroup, strokePath: innerStrokePath, grooveOverlay: innerGrooveOverlay } = createStrokeGroup({ attr: "clip-path", value: `url(#${clipId})` });
  svg.appendChild(innerStrokeGroup);
  const { group: outerStrokeGroup, strokePath: outerStrokePath, grooveOverlay: outerGrooveOverlay } = createStrokeGroup({ attr: "mask", value: `url(#${maskId})` });
  svg.appendChild(outerStrokeGroup);
  const { group: middleStrokeGroup, strokePath: middleStrokePath, grooveOverlay: middleGrooveOverlay } = createStrokeGroup();
  svg.appendChild(middleStrokeGroup);
  anchor.appendChild(svg);
  const innerBorderEls = {
    strokePath: innerStrokePath,
    grooveOverlay: innerGrooveOverlay,
    strokeGroup: innerStrokeGroup,
    dblMaskId: innerDblMaskId,
    dblKnockout: innerDblKnockout,
    dblRect: innerDblRect,
    strokeMultiplier: 2,
    defs,
    gradientEl: null,
    gradientId: `sc-grad-inner-${id}`,
    overlayGradientEl: null,
    overlayGradientId: `sc-grad-inner-ov-${id}`
  };
  const outerBorderEls = {
    strokePath: outerStrokePath,
    grooveOverlay: outerGrooveOverlay,
    strokeGroup: outerStrokeGroup,
    dblMaskId: outerDblMaskId,
    dblKnockout: outerDblKnockout,
    dblRect: outerDblRect,
    strokeMultiplier: 2,
    defs,
    gradientEl: null,
    gradientId: `sc-grad-outer-${id}`,
    overlayGradientEl: null,
    overlayGradientId: `sc-grad-outer-ov-${id}`,
    padDblMask: (pad, w, h) => padMaskAndRect(outerDblMask, outerDblRect, pad, w, h)
  };
  const middleBorderEls = {
    strokePath: middleStrokePath,
    grooveOverlay: middleGrooveOverlay,
    strokeGroup: middleStrokeGroup,
    dblMaskId: middleDblMaskId,
    dblKnockout: middleDblKnockout,
    dblRect: middleDblRect,
    strokeMultiplier: 1,
    defs,
    gradientEl: null,
    gradientId: `sc-grad-middle-${id}`,
    overlayGradientEl: null,
    overlayGradientId: `sc-grad-middle-ov-${id}`,
    padDblMask: (pad, w, h) => padMaskAndRect(middleDblMask, middleDblRect, pad, w, h)
  };
  return {
    update(options, effects, width, height) {
      if (width <= 0 || height <= 0) return;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      const getPath = createPathCache(options);
      const d = getPath(width, height, options, 0);
      clipShape.setAttribute("d", d);
      maskShape.setAttribute("d", d);
      maskRect.setAttribute("width", String(width));
      maskRect.setAttribute("height", String(height));
      updateBorder(effects.innerBorder, d, width, height, innerBorderEls);
      const ob = effects.outerBorder;
      if (ob && ob.width > 0 && ob.opacity > 0) {
        padMaskAndRect(maskEl, maskRect, ob.width, width, height);
      }
      updateBorder(ob, d, width, height, outerBorderEls);
      updateBorder(effects.middleBorder, d, width, height, middleBorderEls);
      const rawIs = effects.innerShadow;
      const isArr = rawIs == null ? [] : Array.isArray(rawIs) ? rawIs : [rawIs];
      while (innerShadowPool.length < isArr.length) {
        innerShadowPool.push(createInnerShadowEntry(defs, isShadowClip));
      }
      while (innerShadowPool.length > isArr.length) {
        removeInnerShadowEntry(innerShadowPool.pop());
      }
      for (let i = 0; i < isArr.length; i++) {
        const is = isArr[i];
        const entry = innerShadowPool[i];
        if (is.opacity <= 0) {
          entry.rect.style.display = "none";
          continue;
        }
        entry.rect.style.display = "";
        const spread = is.spread;
        const pad = Math.max(is.blur * 3, 20) + Math.max(Math.abs(is.offsetX), Math.abs(is.offsetY)) + Math.abs(spread);
        padMaskAndRect(entry.mask, entry.maskRect, pad, width, height);
        const cutW = Math.max(1, width - spread * 2);
        const cutH = Math.max(1, height - spread * 2);
        const cutOpts = spread !== 0 ? adjustOptions(options, -spread) : options;
        entry.maskCutout.setAttribute("d", getPath(cutW, cutH, cutOpts, -spread));
        entry.maskCutout.setAttribute(
          "transform",
          `translate(${is.offsetX + spread},${is.offsetY + spread})`
        );
        if (is.blur > 0) {
          entry.feBlur.setAttribute("stdDeviation", String(is.blur));
          entry.blurGroup.setAttribute("filter", `url(#${entry.filterId})`);
        } else {
          entry.blurGroup.removeAttribute("filter");
        }
        padBounds(entry.rect, pad, width, height);
        entry.rect.setAttribute("fill", hexToRgb(is.color));
        entry.rect.setAttribute("fill-opacity", String(is.opacity));
      }
    },
    destroy() {
      svg.remove();
    }
  };
}

// src/drop-shadow.ts
function computeFilterPad(blur, spread) {
  return Math.ceil(3 * blur + Math.abs(spread) + 1);
}
function setFilterRegionUserSpace(filterEl, shadowWidth, shadowHeight, pad) {
  filterEl.setAttribute("x", String(-pad));
  filterEl.setAttribute("y", String(-pad));
  filterEl.setAttribute("width", String(shadowWidth + 2 * pad));
  filterEl.setAttribute("height", String(shadowHeight + 2 * pad));
}
function createShadowEntry(defs, svg) {
  const filterId = `sc-shadow-${nextUid()}`;
  const filterEl = document.createElementNS(SVG_NS, "filter");
  filterEl.setAttribute("id", filterId);
  filterEl.setAttribute("filterUnits", "userSpaceOnUse");
  filterEl.setAttribute("color-interpolation-filters", "sRGB");
  const feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", "0");
  filterEl.appendChild(feBlur);
  defs.appendChild(filterEl);
  const pathEl = document.createElementNS(SVG_NS, "path");
  svg.appendChild(pathEl);
  return { filterId, filterEl, feBlur, pathEl };
}
function removeShadowEntry(entry) {
  entry.filterEl.remove();
  entry.pathEl.remove();
}
function createDropShadow(anchor) {
  const savedIsolation = anchor.style.isolation;
  anchor.style.isolation = "isolate";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.style.cssText = "position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:-1";
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG_NS, "defs");
  svg.appendChild(defs);
  anchor.appendChild(svg);
  const pool = [];
  return {
    update(options, shadow, width, height) {
      const arr = Array.isArray(shadow) ? shadow : [shadow];
      const hasVisible = width > 0 && height > 0 && arr.some((s) => s.opacity > 0);
      if (!hasVisible) {
        svg.style.display = "none";
        return;
      }
      while (pool.length < arr.length) pool.push(createShadowEntry(defs, svg));
      while (pool.length > arr.length) removeShadowEntry(pool.pop());
      const getPath = createPathCache(options);
      let anyVisible = false;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        const entry = pool[arr.length - 1 - i];
        if (s.opacity <= 0) {
          entry.pathEl.style.display = "none";
          continue;
        }
        const spread = s.spread;
        const shadowWidth = width + spread * 2;
        const shadowHeight = height + spread * 2;
        if (shadowWidth <= 0 || shadowHeight <= 0) {
          entry.pathEl.style.display = "none";
          continue;
        }
        anyVisible = true;
        entry.pathEl.style.display = "";
        const colour = hexToRgb(s.color);
        const adjusted = adjustOptions(options, spread);
        entry.pathEl.setAttribute("d", getPath(shadowWidth, shadowHeight, adjusted, spread));
        entry.pathEl.setAttribute("transform", `translate(${s.offsetX - spread},${s.offsetY - spread})`);
        entry.pathEl.setAttribute("fill", colour);
        entry.pathEl.setAttribute("fill-opacity", String(s.opacity));
        if (s.blur > 0) {
          const pad = computeFilterPad(s.blur, spread);
          setFilterRegionUserSpace(entry.filterEl, shadowWidth, shadowHeight, pad);
          entry.feBlur.setAttribute("stdDeviation", String(s.blur));
          entry.pathEl.setAttribute("filter", `url(#${entry.filterId})`);
        } else {
          entry.pathEl.removeAttribute("filter");
        }
      }
      svg.style.display = anyVisible ? "" : "none";
    },
    destroy() {
      svg.remove();
      anchor.style.isolation = savedIsolation;
    }
  };
}

// src/observe-resize.ts
var observer = null;
var rafId;
var callbackMap = /* @__PURE__ */ new Map();
var pendingElements = /* @__PURE__ */ new Set();
function flush() {
  rafId = void 0;
  const elements = [...pendingElements];
  pendingElements.clear();
  for (const el of elements) {
    const cbs = callbackMap.get(el);
    if (cbs) for (const cb of [...cbs]) cb();
  }
}
function getObserver() {
  if (!observer) {
    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        pendingElements.add(entry.target);
      }
      if (rafId === void 0) {
        rafId = requestAnimationFrame(flush);
      }
    });
  }
  return observer;
}
function observeResize(el, callback) {
  if (typeof ResizeObserver === "undefined") return () => {
  };
  const obs = getObserver();
  let set = callbackMap.get(el);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    callbackMap.set(el, set);
    obs.observe(el);
  }
  set.add(callback);
  pendingElements.add(el);
  if (rafId === void 0) {
    rafId = requestAnimationFrame(flush);
  }
  return () => {
    set.delete(callback);
    if (set.size === 0) {
      callbackMap.delete(el);
      obs.unobserve(el);
    }
    if (callbackMap.size === 0) {
      if (rafId !== void 0) {
        cancelAnimationFrame(rafId);
        rafId = void 0;
      }
      pendingElements.clear();
      observer?.disconnect();
      observer = null;
    }
  };
}

// src/layout-size.ts
function getLayoutSize(el) {
  const style = window.getComputedStyle(el);
  const w = parseFloat(style.width);
  const h = parseFloat(style.height);
  if (Number.isNaN(w) || Number.isNaN(h)) {
    return { width: el.offsetWidth, height: el.offsetHeight };
  }
  if (style.boxSizing === "border-box") {
    return { width: w, height: h };
  }
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const bdrX = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
  const bdrY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  return { width: w + padX + bdrX, height: h + padY + bdrY };
}

// src/extract-effects.ts
function parseColor(raw) {
  const match = raw.match(
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/
  );
  if (!match) return void 0;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== void 0 ? Number(match[4]) : 1;
  const hex = "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
  return { hex, opacity: a };
}
function parseBorder(el) {
  const cs = getComputedStyle(el);
  const style = cs.borderTopStyle;
  if (style === "none" || style === "hidden") return void 0;
  const width = parseFloat(cs.borderTopWidth);
  if (width <= 0 || isNaN(width)) return void 0;
  const color = parseColor(cs.borderTopColor);
  if (!color || color.opacity <= 0) return void 0;
  const supportedStyles = {
    solid: "solid",
    dashed: "dashed",
    dotted: "dotted",
    double: "double",
    groove: "groove",
    ridge: "ridge"
  };
  const borderStyle = supportedStyles[style];
  return {
    width,
    color: color.hex,
    opacity: color.opacity,
    ...borderStyle && borderStyle !== "solid" ? { style: borderStyle } : {}
  };
}
function parseBoxShadow(raw) {
  if (!raw || raw === "none") return {};
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "(") depth++;
    else if (raw[i] === ")") depth--;
    else if (raw[i] === "," && depth === 0) {
      parts.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(raw.slice(start).trim());
  const shadows = [];
  const innerShadows = [];
  for (const part of parts) {
    const isInset = part.includes("inset");
    const cleaned = part.replace("inset", "").trim();
    const colorMatch = cleaned.match(/rgba?\([^)]+\)/);
    if (!colorMatch) continue;
    const color = parseColor(colorMatch[0]);
    if (!color || color.opacity <= 0) continue;
    const rest = cleaned.replace(colorMatch[0], "").trim();
    const values = rest.split(/\s+/).map(parseFloat).filter((v) => !isNaN(v));
    if (values.length < 2) continue;
    const config = {
      offsetX: values[0],
      offsetY: values[1],
      blur: values[2] ?? 0,
      spread: values[3] ?? 0,
      color: color.hex,
      opacity: color.opacity
    };
    (isInset ? innerShadows : shadows).push(config);
  }
  return {
    shadow: shadows.length > 0 ? shadows : void 0,
    innerShadow: innerShadows.length > 0 ? innerShadows : void 0
  };
}
function extractAndStripEffects(el) {
  const savedStyles = {
    border: el.style.border,
    boxShadow: el.style.boxShadow,
    paddingTop: el.style.paddingTop,
    paddingRight: el.style.paddingRight,
    paddingBottom: el.style.paddingBottom,
    paddingLeft: el.style.paddingLeft
  };
  const innerBorder = parseBorder(el);
  const cs = getComputedStyle(el);
  const { shadow, innerShadow } = parseBoxShadow(cs.boxShadow);
  const boxSizing = cs.boxSizing;
  const borderTopW = parseFloat(cs.borderTopWidth) || 0;
  const borderRightW = parseFloat(cs.borderRightWidth) || 0;
  const borderBottomW = parseFloat(cs.borderBottomWidth) || 0;
  const borderLeftW = parseFloat(cs.borderLeftWidth) || 0;
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  const paddingRight = parseFloat(cs.paddingRight) || 0;
  const paddingBottom = parseFloat(cs.paddingBottom) || 0;
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  if (innerBorder) el.style.border = "0";
  if (shadow || innerShadow) el.style.boxShadow = "none";
  if (innerBorder && boxSizing === "content-box" && (borderTopW > 0 || borderRightW > 0 || borderBottomW > 0 || borderLeftW > 0)) {
    el.style.paddingTop = paddingTop + borderTopW + "px";
    el.style.paddingRight = paddingRight + borderRightW + "px";
    el.style.paddingBottom = paddingBottom + borderBottomW + "px";
    el.style.paddingLeft = paddingLeft + borderLeftW + "px";
  }
  const effects = {};
  if (innerBorder) effects.innerBorder = innerBorder;
  if (shadow) effects.shadow = shadow;
  if (innerShadow) effects.innerShadow = innerShadow;
  return { effects, savedStyles };
}
function hasEffects(config) {
  if (!config) return false;
  return !!(config.innerBorder || config.outerBorder || config.middleBorder || config.innerShadow || config.shadow);
}
function mergeEffects(extracted, explicit) {
  return { ...extracted?.effects, ...explicit };
}
function restoreStyles(el, saved) {
  el.style.border = saved.border;
  el.style.boxShadow = saved.boxShadow;
  el.style.paddingTop = saved.paddingTop;
  el.style.paddingRight = saved.paddingRight;
  el.style.paddingBottom = saved.paddingBottom;
  el.style.paddingLeft = saved.paddingLeft;
}

// src/position-ref-count.ts
var refCounts = /* @__PURE__ */ new WeakMap();
function acquirePosition(anchor) {
  const count = refCounts.get(anchor) ?? 0;
  if (count > 0) {
    refCounts.set(anchor, count + 1);
    return true;
  }
  const pos = getComputedStyle(anchor).position;
  if (pos !== "static" && pos !== "") return false;
  refCounts.set(anchor, 1);
  anchor.style.position = "relative";
  return true;
}
function releasePosition(anchor) {
  const count = refCounts.get(anchor);
  if (count === void 0) return;
  if (count <= 1) {
    refCounts.delete(anchor);
    anchor.style.position = "";
  } else {
    refCounts.set(anchor, count - 1);
  }
}
export {
  CURVE_TYPES,
  DEFAULT_CURVE,
  DEFAULT_EXPONENT,
  DEFAULT_PRESERVE_SMOOTHING,
  DEFAULT_SHADOW,
  DEFAULT_SMOOTHING,
  acquirePosition,
  buildArc,
  buildClothoid,
  buildSquircle,
  buildSuperellipse,
  clearCurveCache,
  createDropShadow,
  createSvgEffects,
  distributeAndNormalize,
  extractAndStripEffects,
  generateClipPath,
  generatePath,
  getCurveBuilder,
  getLayoutSize,
  getPathParamsForCorner,
  getSVGPathFromPathParams,
  hasEffects,
  mergeEffects,
  observeResize,
  parseBorder,
  parseBoxShadow,
  parseColor,
  releasePosition,
  restoreStyles,
  rounded,
  toRadians
};
//# sourceMappingURL=index.js.map