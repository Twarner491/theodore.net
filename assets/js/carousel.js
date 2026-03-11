// Image Carousel JavaScript
class ImageCarousel {
  constructor(containerId, imageFolder, customImages = null) {
    this.container = document.getElementById(containerId);
    this.imageFolder = imageFolder;
    this.currentIndex = 0;
    this.images = [];
    this.customImages = customImages;
    this.autoPlayInterval = null;
    this.autoPlayDelay = 4000; // 4 seconds
    
    this.init();
  }

  async init() {
    await this.loadImages();
    this.createCarousel();
    this.startAutoPlay();
    this.bindEvents();
  }

  async loadImages() {
    // If custom images are provided, use them; otherwise use default
    if (this.customImages) {
      this.images = this.customImages;
    } else {
      // Default images for the "20/favs" folder
      this.images = [
        '1.JPG',
        '2.jpg',
        '3.JPG',
        '5.jpg',
        '6.jpg',
        '7.jpg',
        '8.jpg',
        '9.jpg',
        '10.jpg',
        '11.JPG',
        '12.JPG',
        '13.jpg',
        '14.jpg',
        '15.JPG',
        '16.JPG',
        '17.JPG',
        '18.JPG',
        '19.JPG',
        '20.JPG',
        '21.jpg',
        '22.JPG',
        '23.JPG',
        '24.jpg',
        '25.jpg',
        '26.jpg',
        '27.jpeg',
        '28.jpg',
        '29.jpg',
        '30.jpg',
        '31.jpg',
        '32.jpg',
        '33.jpg',
        '35.JPG',
        '37.jpg'
      ];
    }
  }

  createCarousel() {
    if (!this.container || this.images.length === 0) return;

    // Create carousel structure
    this.container.innerHTML = `
      <div class="carousel-wrapper">
        <button class="carousel-btn prev" aria-label="Previous image">
          <i class="fas fa-chevron-left"></i>
        </button>
        
        <div class="carousel-container">
          ${this.images.map((image, index) => `
            <div class="carousel-slide ${index === 0 ? 'active' : ''}">
              <img src="${this.imageFolder}/${image}" alt="Photo ${index + 1}" loading="lazy">
            </div>
          `).join('')}
        </div>
        
        <button class="carousel-btn next" aria-label="Next image">
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    `;

    // Store references to elements
    this.slides = this.container.querySelectorAll('.carousel-slide');
    this.prevBtn = this.container.querySelector('.carousel-btn.prev');
    this.nextBtn = this.container.querySelector('.carousel-btn.next');
  }

  bindEvents() {
    // Previous button
    this.prevBtn.addEventListener('click', () => {
      this.stopAutoPlay();
      this.showPrevious();
      this.startAutoPlay();
    });

    // Next button
    this.nextBtn.addEventListener('click', () => {
      this.stopAutoPlay();
      this.showNext();
      this.startAutoPlay();
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (this.container.contains(document.activeElement) || this.container.matches(':hover')) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.stopAutoPlay();
          this.showPrevious();
          this.startAutoPlay();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.stopAutoPlay();
          this.showNext();
          this.startAutoPlay();
        }
      }
    });

    // Pause auto-play on hover
    this.container.addEventListener('mouseenter', () => {
      this.stopAutoPlay();
    });

    this.container.addEventListener('mouseleave', () => {
      this.startAutoPlay();
    });
  }

  showSlide(index) {
    if (index < 0) index = this.images.length - 1;
    if (index >= this.images.length) index = 0;

    // Hide current slide
    this.slides[this.currentIndex].classList.remove('active');

    // Show new slide
    this.currentIndex = index;
    this.slides[this.currentIndex].classList.add('active');

    // Update button states
    this.updateButtonStates();
  }

  showNext() {
    this.showSlide(this.currentIndex + 1);
  }

  showPrevious() {
    this.showSlide(this.currentIndex - 1);
  }

  updateButtonStates() {
    // Buttons are always enabled since we have circular navigation
    this.prevBtn.disabled = false;
    this.nextBtn.disabled = false;
  }

  startAutoPlay() {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
    }
    this.autoPlayInterval = setInterval(() => {
      this.showNext();
    }, this.autoPlayDelay);
  }

  stopAutoPlay() {
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
      this.autoPlayInterval = null;
    }
  }
}

// Carousel initialization is handled by page-specific scripts or the
// tufte_elements.py hook via {.carousel}folder{/.carousel} shorthand.