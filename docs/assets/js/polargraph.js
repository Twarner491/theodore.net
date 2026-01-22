// Plot Carousel with Minimal Physics
class PlotCarousel {
  constructor(container) {
    this.container = container;
    this.carousel = container.querySelector('.plot-carousel');
    this.items = container.querySelectorAll('.plot-item');
    
    // Physics properties
    this.isDragging = false;
    this.startX = 0;
    this.scrollLeft = 0;
    this.velocity = 0;
    this.momentum = 0.92;
    this.lastTime = 0;
    this.lastX = 0;
    
    // Animation frame
    this.animationFrame = null;
    
    this.init();
  }
  
  init() {
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    // Mouse events
    this.carousel.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.carousel.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.carousel.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.carousel.addEventListener('mouseleave', this.handleMouseUp.bind(this));
    
    // Touch events
    this.carousel.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.carousel.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.carousel.addEventListener('touchend', this.handleTouchEnd.bind(this));
    
    // Scroll events for physics
    this.carousel.addEventListener('scroll', this.handleScroll.bind(this));
    
    // Wheel events for horizontal scrolling
    const wheelHandler = this.handleWheel.bind(this);
    this.carousel.addEventListener('wheel', wheelHandler, { passive: false });
    this.container.addEventListener('wheel', wheelHandler, { passive: false });
  }
  
  handleMouseDown(e) {
    if (e.target.tagName === 'IMG') {
      this.carousel.style.cursor = 'grab';
    }
    
    this.isDragging = true;
    this.carousel.classList.add('dragging');
    this.startX = e.pageX - this.carousel.offsetLeft;
    this.scrollLeft = this.carousel.scrollLeft;
    this.velocity = 0;
    this.lastTime = performance.now();
    this.lastX = e.pageX;
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    
    e.preventDefault();
  }
  
  handleMouseMove(e) {
    if (!this.isDragging) return;
    
    e.preventDefault();
    
    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    const deltaX = e.pageX - this.lastX;
    
    if (deltaTime > 0) {
      this.velocity = deltaX / deltaTime;
    }
    
    const x = e.pageX - this.carousel.offsetLeft;
    const walk = (x - this.startX) * 2.5;
    this.carousel.scrollLeft = this.scrollLeft - walk;
    
    this.lastTime = currentTime;
    this.lastX = e.pageX;
  }
  
  handleMouseUp(e) {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    this.carousel.classList.remove('dragging');
    
    this.applyMomentum();
  }
  
  handleTouchStart(e) {
    const touch = e.touches[0];
    this.handleMouseDown({ 
      pageX: touch.pageX, 
      preventDefault: () => e.preventDefault() 
    });
  }
  
  handleTouchMove(e) {
    if (!this.isDragging) return;
    const touch = e.touches[0];
    this.handleMouseMove({ 
      pageX: touch.pageX, 
      preventDefault: () => e.preventDefault() 
    });
  }
  
  handleTouchEnd(e) {
    this.handleMouseUp(e);
  }
  
  handleScroll() {
    this.applyScrollPhysics();
  }
  
  handleWheel(e) {
    const rect = this.container.getBoundingClientRect();
    const isHovering = e.clientX >= rect.left && e.clientX <= rect.right &&
                       e.clientY >= rect.top && e.clientY <= rect.bottom;
    
    if (!isHovering) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    this.carousel.scrollLeft += delta * 3.5;
    
    this.applyScrollPhysics();
  }
  
  applyMomentum() {
    if (Math.abs(this.velocity) < 0.1) return;
    
    const animate = () => {
      this.velocity *= this.momentum;
      this.carousel.scrollLeft -= this.velocity * 8;
      
      if (Math.abs(this.velocity) > 0.1) {
        this.animationFrame = requestAnimationFrame(animate);
      }
    };
    
    this.animationFrame = requestAnimationFrame(animate);
  }
  
  applyScrollPhysics() {
    this.items.forEach(item => {
      item.classList.remove('scroll-left', 'scroll-right', 'scroll-physics');
    });
    
    const visibleItems = this.getVisibleItems();
    const scrollDirection = this.getScrollDirection();
    
    visibleItems.forEach((item, index) => {
      setTimeout(() => {
        item.classList.add('scroll-physics');
        if (scrollDirection === 'left') {
          item.classList.add('scroll-left');
        } else if (scrollDirection === 'right') {
          item.classList.add('scroll-right');
        }
        
        setTimeout(() => {
          item.classList.remove('scroll-left', 'scroll-right', 'scroll-physics');
        }, 300);
      }, index * 20);
    });
  }
  
  getVisibleItems() {
    const containerRect = this.carousel.getBoundingClientRect();
    return Array.from(this.items).filter(item => {
      const itemRect = item.getBoundingClientRect();
      return itemRect.right > containerRect.left && itemRect.left < containerRect.right;
    });
  }
  
  getScrollDirection() {
    const currentScroll = this.carousel.scrollLeft;
    const direction = currentScroll > (this.lastScrollLeft || 0) ? 'right' : 'left';
    this.lastScrollLeft = currentScroll;
    return direction;
  }
}

// Initialize carousel when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  const carouselContainer = document.querySelector('.plot-carousel-container');
  if (carouselContainer) {
    new PlotCarousel(carouselContainer);
  }
  
  // Initialize Sonakinatography demo
  initSonakinatography();
  
  // Initialize GPenT prompt demo
  initGPenTDemo();
});

// Also try to initialize when page content changes (for MkDocs navigation)
if (typeof document$ !== 'undefined') {
  document$.subscribe(function() {
    initSonakinatography();
    initGPenTDemo();
  });
}

function initSonakinatography() {
  const sonoDemo = document.querySelector('.sonakinatography-demo');
  if (sonoDemo && !sonoDemo.hasAttribute('data-initialized')) {
    sonoDemo.setAttribute('data-initialized', 'true');
    new SonakinatographyDemo(sonoDemo);
  }
}

// Sonakinatography Demo
class SonakinatographyDemo {
  constructor(container) {
    this.container = container;
    this.svgContainer = container.querySelector('.sono-svg-container');
    this.textarea = container.querySelector('.sono-textarea');
    this.algoSelect = container.querySelector('#sono-algorithm');
    this.generateBtn = container.querySelector('.sono-generate-btn');
    this.emptyState = container.querySelector('.sono-empty-state');
    
    this.examplePoems = {
      'pangram': 'The quick brown fox jumps over the lazy dog',
      'frost': 'Two roads diverged in a yellow wood\nAnd sorry I could not travel both\nAnd be one traveler long I stood\nAnd looked down one as far as I could\nTo where it bent in the undergrowth',
      'shakespeare': 'Shall I compare thee to a summer\'s day\nThou art more lovely and more temperate\nRough winds do shake the darling buds of May\nAnd summer\'s lease hath all too short a date',
      'dickinson': 'Because I could not stop for Death\nHe kindly stopped for me\nThe Carriage held but just Ourselves\nAnd Immortality',
      'haiku': 'An old silent pond\nA frog jumps into the pond\nSplash silence again'
    };
    
    this.currentData = null;
    this.init();
  }
  
  init() {
    if (!this.svgContainer || !this.textarea || !this.algoSelect || !this.generateBtn) {
      console.error('Sonakinatography: Missing required elements');
      return;
    }
    this.setupEventListeners();
    this.setupThemeObserver();
  }
  
  setupThemeObserver() {
    // Re-render when theme changes (dark/light mode)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-md-color-scheme' || 
            mutation.attributeName === 'data-md-color-primary') {
          if (this.currentData) {
            this.render(this.currentData);
          }
          break;
        }
      }
    });
    
    // Observe body for MkDocs Material theme changes
    observer.observe(document.body, { attributes: true });
    
    // Also observe html element
    observer.observe(document.documentElement, { attributes: true });
  }
  
  setupEventListeners() {
    // Example buttons - only load text, don't auto-generate
    this.container.querySelectorAll('.sono-example-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = e.target.dataset.example;
        if (this.examplePoems[key]) {
          this.textarea.value = this.examplePoems[key];
          this.textarea.style.minHeight = '140px';
          this.container.querySelectorAll('.sono-example-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
        }
      });
    });
    
    this.generateBtn.addEventListener('click', () => this.generate());
    
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        this.generate();
      }
    });
  }
  
  // Letter position algorithm: A,I,Q,Y→1, B,J,R,Z→2, etc.
  letterToEntity(char) {
    if (!/[a-zA-Z]/.test(char)) return null;
    return ((char.toUpperCase().charCodeAt(0) - 65) % 8) + 1;
  }
  
  textToLetterSequence(text) {
    const sequence = [];
    for (const char of text) {
      const entity = this.letterToEntity(char);
      if (entity !== null) {
        sequence.push({ char, entity });
      }
    }
    return sequence;
  }
  
  countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    
    const exceptions = {
      'the': 1, 'to': 1, 'a': 1, 'i': 1, 'be': 1, 'we': 1, 'he': 1, 'me': 1,
      'are': 1, 'were': 1, 'been': 1, 'being': 2, 'have': 1, 'has': 1, 'had': 1,
      'do': 1, 'does': 1, 'did': 1, 'will': 1, 'would': 1, 'could': 1, 'should': 1,
      'every': 3, 'different': 3, 'evening': 3, 'interesting': 4, 'comfortable': 4,
      'family': 3, 'favorite': 3, 'generally': 4, 'literally': 4, 'beautiful': 3,
      'poem': 2, 'quiet': 2, 'science': 2, 'area': 3, 'idea': 3,
      'real': 1, 'hour': 1, 'fire': 1, 'cruel': 2, 'fuel': 2,
      'smiled': 1, 'walked': 1, 'talked': 1, 'loved': 1, 'lived': 1, 'moved': 1,
      'carriage': 2, 'marriage': 2, 'garage': 2, 'average': 3,
      'thou': 1, 'thee': 1, 'thy': 1, 'hath': 1, 'doth': 1, 'art': 1
    };
    
    if (exceptions[word]) return exceptions[word];
    
    let count = 0;
    const vowels = 'aeiouy';
    let prevWasVowel = false;
    
    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !prevWasVowel) count++;
      prevWasVowel = isVowel;
    }
    
    if (word.endsWith('e') && count > 1 && !word.endsWith('le')) count--;
    if (word.endsWith('ed') && count > 1 && !word.endsWith('ted') && !word.endsWith('ded')) count--;
    
    return Math.max(1, count);
  }
  
  tokenize(text) {
    return text.split(/\s+/).map(w => w.replace(/[^\w'-]/g, '')).filter(w => w.length > 0);
  }
  
  textToSyllableSequence(text) {
    // Each word becomes a block where:
    // - 1 syllable word → entity 1 (occupies 1 beat, narrowest, darkest)
    // - 2 syllable word → entity 2 (occupies 2 beats)
    // - ... up to 8+ syllables → entity 8 (widest, lightest)
    const words = this.tokenize(text);
    return words.map(word => {
      const syllables = this.countSyllables(word);
      const entity = Math.max(1, Math.min(8, syllables));  // Clamp to 1-8
      return { word, entity };
    });
  }
  
  generate() {
    const text = this.textarea.value.trim();
    if (!text) {
      this.showEmptyState();
      return;
    }
    
    const algorithm = this.algoSelect.value;
    let sequence;
    
    if (algorithm === 'letter') {
      sequence = this.textToLetterSequence(text);
    } else {
      sequence = this.textToSyllableSequence(text);
    }
    
    this.currentData = { sequence, algorithm, text };
    this.render(this.currentData);
  }
  
  render(data) {
    const { sequence, algorithm } = data;
    this.hideEmptyState();
    this.renderSVG(sequence, algorithm);
  }
  
  renderSVG(sequence, algorithm) {
    // Opacities: entity 1 = darkest, entity 8 = lightest
    const opacities = [0.92, 0.80, 0.68, 0.56, 0.44, 0.32, 0.20, 0.08];
    
    const numRows = 8;
    const rowHeight = 16;
    const gridWidth = 64;
    
    // Detect theme from MkDocs Material's data attribute
    const isDark = document.body.getAttribute('data-md-color-scheme') === 'slate' ||
                   document.documentElement.getAttribute('data-md-color-scheme') === 'slate';
    
    // Use appropriate colors for light/dark mode
    const fgColor = isDark ? '#ffffff' : '#000000';
    const bgColor = isDark ? '#2e303e' : '#ffffff';
    
    const blocks = [];
    
    if (algorithm === 'syllable') {
      // SYLLABLE COUNT: Timeline where each word advances globally
      let x = 0;
      
      for (const item of sequence) {
        const entity = item.entity;
        const row = entity - 1;
        
        blocks.push({ row, x, w: entity, entity });
        x += entity;
      }
      
      const totalWidth = x;
      const svgWidth = 1000;
      const svgHeight = numRows * rowHeight;
      const scale = svgWidth / Math.max(totalWidth, 1);
      
      const rects = blocks.map(b => {
        const px = b.x * scale;
        const py = b.row * rowHeight;
        const pw = b.w * scale;
        const op = opacities[b.entity - 1];
        return `<rect x="${px.toFixed(1)}" y="${py}" width="${pw.toFixed(1)}" height="${rowHeight}" fill="${fgColor}" fill-opacity="${op}" stroke="${bgColor}" stroke-width="1"/>`;
      });
      
      this.svgContainer.innerHTML = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="sono-svg">${rects.join('')}</svg>`;
      
    } else {
      // LETTER POSITION: Sequential filling, left-to-right, wrap rows when full
      let row = 0;
      let x = 0;
      
      for (const item of sequence) {
        const entity = item.entity;
        
        if (x + entity > gridWidth) {
          row++;
          x = 0;
          if (row >= numRows) break;
        }
        
        blocks.push({ row, x, w: entity, entity });
        x += entity;
      }
      
      const maxX = blocks.reduce((max, b) => Math.max(max, b.x + b.w), gridWidth);
      const svgWidth = 1000;
      const actualRows = Math.max(row + 1, 1);
      const svgHeight = actualRows * rowHeight;
      const scale = svgWidth / maxX;
      
      const rects = blocks.map(b => {
        const px = b.x * scale;
        const py = b.row * rowHeight;
        const pw = b.w * scale;
        const op = opacities[b.entity - 1];
        return `<rect x="${px.toFixed(1)}" y="${py}" width="${pw.toFixed(1)}" height="${rowHeight}" fill="${fgColor}" fill-opacity="${op}" stroke="${bgColor}" stroke-width="1"/>`;
      });
      
      this.svgContainer.innerHTML = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="sono-svg">${rects.join('')}</svg>`;
    }
  }
  
  showEmptyState() {
    if (this.emptyState) this.emptyState.style.display = 'flex';
    this.svgContainer.innerHTML = '';
  }
  
  hideEmptyState() {
    if (this.emptyState) this.emptyState.style.display = 'none';
  }
}

// GPenT Prompt Demo - Shows the Gemini prompt with cycling variables
function initGPenTDemo() {
  const demo = document.querySelector('.gpent-prompt-demo');
  if (demo && !demo.hasAttribute('data-initialized')) {
    demo.setAttribute('data-initialized', 'true');
    new GPenTPromptDemo(demo);
  }
}

class GPenTPromptDemo {
  constructor(container) {
    this.container = container;
    this.varElements = container.querySelectorAll('.prompt-var');
    
    // Define the cycling values for each variable
    this.variableData = {
      whisper: [
        'ocean waves',
        'midnight forest',
        'geometric chaos',
        'zen garden',
        'cosmic spiral',
        'urban rhythm',
        'crystalline forms',
        'autumn leaves'
      ],
      gen1: [
        '9: Flow Field - options: lines (50-1000), length (10-200), scale (0.001-0.1)',
        '12: Slime Mold - options: agents (100-10000), iterations (50-1000), sensor_angle (10-90)',
        '22: Kaleidoscope - options: symmetry (4-16), pattern (curves/lines/spirals), complexity (5-20)',
        '7: Fractal Tree - options: depth (1-12), trunk_length (20-200), angle (10-45), ratio (0.5-0.9)',
        '16: Glow (Multi-Color) - options: color_profile (rainbow/warm/cool), particles (100-2000)'
      ],
      gen2: [
        '1: Spiral - options: turns (1-50), spacing (1-20)',
        '2: Spirograph - options: R (10-300), r (5-150), d (5-200), revolutions (1-100)',
        '6: Hilbert Curve - options: order (1-7), size (100-800)',
        '5: Dragon Curve - options: iterations (1-16), size (1-10)',
        '18: Game of Life - options: cell_size (5-30mm), generations (10-200)'
      ],
      gen3: [
        '22: Kaleidoscope - options: symmetry (4-16), pattern (curves/lines/spirals), complexity (5-20)',
        '3: Lissajous - options: a (1-20), b (1-20), delta (0-180), size (50-500)',
        '19: Zen Pots - options: pot_count (3-20), pot_color (terracotta/earth/slate)',
        '21: Perlin Noise Dots - options: grid_spacing (5-30mm), shape (circle/square/diamond)',
        '14: Poetry Clouds - options: text_size (3-20mm), cloud_threshold (0.3-0.7)'
      ],
      color1: [
        '3: Blue',
        '7: Red',
        '5: Purple',
        '8: Orange',
        '4: Green'
      ],
      color2: [
        '2: Black',
        '1: Brown',
        '6: Pink',
        '9: Yellow',
        '4: Green'
      ],
      color3: [
        '4: Green',
        '3: Blue',
        '5: Purple',
        '1: Brown',
        '7: Red'
      ]
    };
    
    // Track current index for each variable
    this.currentIndices = {};
    for (const key in this.variableData) {
      this.currentIndices[key] = 0;
    }
    
    // Characters for cipher effect
    this.cipherChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    this.init();
  }
  
  init() {
    // Start cycling different variables at staggered intervals
    this.startCycling();
  }
  
  startCycling() {
    // Cycle whisper every 3.5 seconds
    setInterval(() => this.cycleVariable('whisper'), 3500);
    
    // Cycle generators at different offsets
    setTimeout(() => {
      setInterval(() => this.cycleVariable('gen1'), 4200);
    }, 800);
    
    setTimeout(() => {
      setInterval(() => this.cycleVariable('gen2'), 4800);
    }, 1600);
    
    setTimeout(() => {
      setInterval(() => this.cycleVariable('gen3'), 5100);
    }, 2400);
    
    // Cycle colors
    setTimeout(() => {
      setInterval(() => this.cycleVariable('color1'), 3800);
    }, 500);
    
    setTimeout(() => {
      setInterval(() => this.cycleVariable('color2'), 4500);
    }, 1200);
    
    setTimeout(() => {
      setInterval(() => this.cycleVariable('color3'), 5000);
    }, 2000);
  }
  
  cycleVariable(varName) {
    const element = this.container.querySelector(`[data-var="${varName}"]`);
    if (!element) return;
    
    const values = this.variableData[varName];
    const nextIndex = (this.currentIndices[varName] + 1) % values.length;
    const nextValue = values[nextIndex];
    
    this.currentIndices[varName] = nextIndex;
    
    // Perform cipher scramble effect
    this.scrambleTransition(element, nextValue);
  }
  
  scrambleTransition(element, targetText) {
    const originalText = element.textContent;
    const maxLength = Math.max(originalText.length, targetText.length);
    
    element.classList.add('scrambling');
    
    let iteration = 0;
    const totalIterations = 12;
    const intervalTime = 35;
    
    const interval = setInterval(() => {
      let result = '';
      const progress = iteration / totalIterations;
      
      for (let i = 0; i < maxLength; i++) {
        // Characters that have "resolved" to their final state
        const resolveThreshold = (i / maxLength) * 0.7;
        
        if (progress > resolveThreshold + 0.3) {
          // Show final character
          result += targetText[i] || '';
        } else if (progress > resolveThreshold) {
          // Scrambling phase - show random character
          result += this.cipherChars[Math.floor(Math.random() * this.cipherChars.length)];
        } else {
          // Still showing original (or transitioning)
          if (Math.random() > 0.7) {
            result += this.cipherChars[Math.floor(Math.random() * this.cipherChars.length)];
          } else {
            result += originalText[i] || this.cipherChars[Math.floor(Math.random() * this.cipherChars.length)];
          }
        }
      }
      
      element.textContent = result;
      iteration++;
      
      if (iteration >= totalIterations) {
        clearInterval(interval);
        element.textContent = targetText;
        element.classList.remove('scrambling');
      }
    }, intervalTime);
  }
}
