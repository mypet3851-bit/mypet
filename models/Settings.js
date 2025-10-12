import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    default: 'Eva Curves Fashion Store'
  },
  email: {
    type: String,
    required: true,
    default: 'contact@evacurves.com'
  },
  phone: {
    type: String,
    default: '+1 (555) 123-4567'
  },
  address: {
    type: String,
    default: '123 Fashion Street, NY 10001'
  },
  // Optional public URL or map link for the store location (e.g. Google Maps / Waze / custom contact page)
  // Example: https://www.google.com/maps/search/?api=1&query=Your+Store+Address
  // Keep as simple string (not required) to avoid over‑validating; frontend can ensure proper URL format.
  addressLink: {
    type: String,
    default: ''
  },
  currency: {
    type: String,
    required: true,
    enum: ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'LBP', 'EGP', 'IQD', 'ILS'],
    default: 'USD'
  },
  timezone: {
    type: String,
    required: true,
    default: 'UTC-5'
  },
  logo: {
    type: String,
    default: null
  },
  // Favicon (SVG/PNG/ICO). Managed via admin panel; when set, overrides default /favicon.svg served from public root.
  favicon: {
    type: String,
    default: null
  },
  // Background image for authentication pages (login/register)
  authBackgroundImage: {
    type: String,
    default: ''
  },
  // Logo sizing (persisted so guests see admin changes)
  logoWidthMobile: {
    type: Number,
    default: 56 // px
  },
  logoMaxHeightMobile: {
    type: Number,
    default: 40 // px
  },
  logoWidthDesktop: {
    type: Number,
    default: 100 // px
  },
  // Backend API base URL (e.g., https://api.example.com). Defaults to local dev server.
  apiBaseUrl: {
    type: String,
    default: 'http://localhost:5000'
  },
  
  // Design/Theme settings
  primaryColor: {
    type: String,
    default: '#3b82f6' // Blue
  },
  secondaryColor: {
    type: String,
    default: '#64748b' // Slate
  },
  accentColor: {
    type: String,
    default: '#f59e0b' // Amber
  },
  // Search box border color (optional) – allows theming search input outline
  searchBorderColor: {
    type: String,
    default: ''
  },
  textColor: {
    type: String,
    default: '#1f2937' // Gray 800
  },
  backgroundColor: {
    type: String,
    default: '#ffffff' // White
  },
  // New Arrivals page (mobile-specific theming)
  newArrivalsMobileHeadingColor: { type: String, default: '' }, // e.g. '#ffffff'
  newArrivalsMobileTextColor: { type: String, default: '' }, // e.g. '#e5e7eb'
  newArrivalsMobileOverlayBg: { type: String, default: '' }, // e.g. 'rgba(0,0,0,0.4)' or hex with opacity via CSS
  newArrivalsMobileProductNameColor: { type: String, default: '' }, // product name color on mobile New Arrivals grid
  newArrivalsMobileProductPriceColor: { type: String, default: '' }, // product price color on mobile New Arrivals grid
  // New Arrivals dedicated banner (optional)
  newArrivalsBannerEnabled: { type: Boolean, default: false }, // toggles banner visibility
  newArrivalsBannerImage: { type: String, default: '' }, // image URL/path (uploaded via admin)
  newArrivalsBannerHeading: { type: String, default: '' }, // overrides default page heading when provided & enabled
  newArrivalsBannerSubheading: { type: String, default: '' }, // optional supporting text under heading
  // Navigation styles (top bar + mega menu)
  navCategoryFontColor: { type: String, default: '' },
  navCategoryFontSize: { type: String, enum: ['small','medium','large'], default: 'medium' },
  navPanelFontColor: { type: String, default: '' },
  navPanelColumnActiveBgColor: { type: String, default: '' },
  navPanelAccentColor: { type: String, default: '' },
  navPanelHeaderColor: { type: String, default: '' },
  fontFamily: {
    type: String,
    default: 'Inter, system-ui, sans-serif'
  },
  headingFont: {
    type: String,
    default: 'Inter, system-ui, sans-serif'
  },
  bodyFont: {
    type: String,
    default: 'Inter, system-ui, sans-serif'
  },
  borderRadius: {
    type: String,
    default: '8px'
  },
  buttonStyle: {
    type: String,
    enum: ['rounded', 'square', 'pill'],
    default: 'rounded'
  },
  
  // Layout settings
  headerLayout: {
    type: String,
    enum: ['classic', 'modern', 'minimal'],
    default: 'modern'
  },
  headerBackgroundColor: {
    type: String,
    default: ''
  },
  headerTextColor: {
    type: String,
    default: ''
  },
  headerIcons: {
    showLanguage: { type: Boolean, default: true },
    showCurrency: { type: Boolean, default: true },
    showSearch: { type: Boolean, default: true },
    showWishlist: { type: Boolean, default: true },
    showCart: { type: Boolean, default: true },
    showAccount: { type: Boolean, default: true }
  },
  // Header icon style variants
  headerIconVariants: {
    cart: { type: String, enum: ['shoppingBag', 'shoppingCart'], default: 'shoppingBag' },
    wishlist: { type: String, enum: ['heart', 'bookmark'], default: 'heart' }
  },
  // Custom header icon URLs
  headerIconAssets: {
    cart: { type: String, default: '' },
    wishlist: { type: String, default: '' },
    account: { type: String, default: '' },
    search: { type: String, default: '' },
    language: { type: String, default: '' },
    currency: { type: String, default: '' }
  },
  footerStyle: {
    type: String,
    enum: ['simple', 'detailed', 'newsletter'],
    default: 'detailed'
  },
  productCardStyle: {
    type: String,
    enum: ['modern', 'classic', 'minimal'],
    default: 'modern'
  },
  // Product grid layout variants
  productGridStyle: {
    type: String,
    enum: ['standard', 'compact', 'masonry', 'list', 'wide', 'gallery', 'carousel'],
    default: 'standard'
  },
  // Product listing filter visibility toggles
  showColorFilter: { type: Boolean, default: true }, // allow hiding color facet from storefront
  
  // Social media links
  socialLinks: {
    facebook: { type: String, default: '' },
    twitter: { type: String, default: '' },
    instagram: { type: String, default: '' },
    youtube: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    tiktok: { type: String, default: '' }
  },
  
  // SEO settings
  siteTitle: {
    type: String,
    default: 'Eva Curves Fashion Store'
  },
  siteDescription: {
    type: String,
    default: 'Premium fashion store offering the latest trends in clothing and accessories'
  },
  keywords: [{
    type: String
  }],
  
  // Analytics
  facebookPixel: {
    pixelId: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  googleAnalytics: {
    trackingId: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  // Scroll-to-top button theme
  scrollTopBgColor: { type: String, default: '' },
  scrollTopTextColor: { type: String, default: '' },
  scrollTopHoverBgColor: { type: String, default: '' },
  scrollTopPingColor: { type: String, default: '' },
  // Add To Cart button theme (persist so guests see admin design)
  atcBgColor: { type: String, default: '' },
  atcTextColor: { type: String, default: '' },
  atcHoverBgColor: { type: String, default: '' },
  // Hero carousel settings
  heroAutoplayMs: {
    type: Number,
    default: 5000, // 5 seconds
    min: 0
  },
  // Google auth configuration (admin managed, non-secret)
  googleAuth: {
    enabled: { type: Boolean, default: false },
    clientId: { type: String, default: '' },
    // Write-only client secret (never returned in GET). If migrating to OAuth code flow.
    clientSecret: { type: String, default: '' }
  }
}, {
  timestamps: true
});

// Cloudinary credentials (server-side use only). Do NOT expose secrets via public GET.
settingsSchema.add({
  cloudinary: {
    cloudName: { type: String, default: '' },
    apiKey: { type: String, default: '' },
    apiSecret: { type: String, default: '' }
  }
});

// Checkout form customization (admin configurable)
settingsSchema.add({
  checkoutForm: {
    showEmail: { type: Boolean, default: false },
    showLastName: { type: Boolean, default: false },
    // Future toggles (currently not rendered in UI):
    showSecondaryMobile: { type: Boolean, default: false },
    showCountry: { type: Boolean, default: false },
    // Cities list for dropdown
    cities: {
      type: [String],
      default: [
        'ابو قويدر',
        'الجولان',
        'الريحانية',
        'الظهرية',
        'ام الفحم',
        'بديا',
        'بيت شيمش',
        'جفعات شموئل',
        'جولس',
        'حزمه',
        'حسنيه',
        'خضيرة',
        'دير رافات',
        'راس علي',
        'رحوفوت',
        'رمانه',
        'رموت هشفيم',
        'صندله',
        'طيرة الكرمل',
        'عين الاسد',
        'عين حوض',
        'كريات اتا',
        'كسرى سميع',
        'لهافيم',
        'معليا',
        'معلي افريم',
        'نهاريا',
        'نوف هجليل',
        'هود هشارون',
        'يوكنعام',
        'ירושלים',
        'الضفة الغربية',
        'منطقة ابو غوش',
        'الداخل',
        'قرى الخليل',
        'قباطية',
        'اريحا',
        'العيزرية',
        'الزعيم',
        'يطا',
        'بيت لحم',
        'الخليل',
        'طوباس',
        'طولكرم',
        'سلفيت',
        'ابو غوش',
        'جنين',
        'قلقيلية',
        'ابو ديس',
        'عين رافا',
        'حيفا',
        'عناتا',
        'سخنين',
        'ضواحي بيت لحم',
        'مخيم شعفاط',
        'ضواحي القدس',
        'السواحرة الشرقية',
        'إم الفحم',
        'البيرة',
        'عين نقوبا',
        'كفر عقب',
        'غزة',
        'ضواحي رام الله',
        'الرام',
        'رام الله',
        'نابلس',
        'ابطن',
        'ابو اسنان',
        'ابو تلول',
        'ابو سنان',
        'ابو قرينات',
        'اريال',
        'اشدود',
        'اشكلون',
        'اعبلين',
        'اكسال',
        'البعنه',
        'البعينة نجيدات',
        'البقيعة',
        'البلدة القديمة أبواب',
        'التله الفرنسيه',
        'الثوري ابوطور',
        'الجش',
        'الجولان',
        'الرامة',
        'الرامه',
        'الرملة',
        'الرينه',
        'الزرازير',
        'الشبلة',
        'الشيخ جراح',
        'الشيخ دنون',
        'الضاحية',
        'الطور',
        'الطيبة',
        'الطيبة الزعبية',
        'الطيرة',
        'العزير',
        'العيسويه',
        'الغجر',
        'الفريديس',
        'القدس',
        'الكعبية',
        'اللد',
        'اللقية',
        'المركز',
        'المزرعة',
        'المزرعه',
        'المشهد',
        'المشيرفه',
        'المغار',
        'الناصرة',
        'الناصره العليا',
        'الناعورة',
        'النقب',
        'النين',
        'ام الغنم',
        'ام القطف',
        'ام بطين',
        'اور يهودا',
        'ايلات',
        'بات يام',
        'بار يعكوف',
        'باقة الغربية',
        'برطعة',
        'بسمة طبعون',
        'بقعاتا',
        'بني براك',
        'بيت جان',
        'بيتح تكفا',
        'بيت حنينا',
        'بيت صفافا',
        'بير السبع',
        'بير السكة',
        'بير المشاش',
        'بير المكسور',
        'ترشيحا',
        'تل ابيب',
        'تل السبع',
        'تل عراد',
        'جبل المكبر',
        'جت',
        'جت الجليل',
        'جديدة',
        'جديده المكر',
        'جسر الزرقاء',
        'جلجوليا',
        'جلجولية',
        'جنوب',
        'حجاجره',
        'حرفيش',
        'حريش',
        'حورة',
        'حولون',
        'خوالد',
        'دالية الكرمل',
        'دبورية',
        'دير الاسد',
        'دير حنا',
        'ديمونا',
        'راس العامود',
        'رعنانا',
        'رمات جان',
        'رمات خوڤاڤ',
        'رهط',
        'روش هعاين',
        'رومانه',
        'ريشون لتسيون',
        'زلفة',
        'زيمر',
        'ساجور',
        'سالم',
        'سلوان',
        'سولم',
        'شارع يافا',
        'شبلي',
        'شعب',
        'شعفاط',
        'شفاعمر',
        'شفاعمرو',
        'شقيب السلام',
        'شمال بعيد',
        'شمال قريب',
        'شمال وسط',
        'صفد',
        'صور باهر',
        'ضميده',
        'طباش',
        'طبريا',
        'طرعان',
        'طمرة',
        'طمرة الزعبية',
        'طوبا الزنجريه',
        'عارة',
        'عرابة',
        'عرابه',
        'عراد',
        'عرب العرامشة',
        'عرب الهيب',
        'عرعرة (الشمال)',
        'عرعره النقب',
        'عسفيا',
        'عطروت',
        'عفولة',
        'عكا',
        'عيلبون',
        'عيلوط',
        'عين السهلة',
        'عين قينيا',
        'عين ماهل',
        'فريديس',
        'فسوطه',
        'قرية دريجات',
        'قصر السر',
        'قلنسوة',
        'كابول',
        'كرمئيل',
        'كريات اونو',
        'كريات شمونه',
        'كسيفه',
        'كعيبة',
        'كفر برا',
        'كفر سميع',
        'كفر قاسم',
        'كفرقرع',
        'كفر قرع',
        'كفر كما',
        'كفر كنا',
        'كفر مصر',
        'كفر مندا',
        'كفر ياسيف',
        'كمانة',
        'كوكب ابو الهيجا',
        'كيبوتس دان',
        'مثلث',
        'مجد الكروم',
        'مجدل شمس',
        'مسعدة',
        'مشيرفة',
        'مصمص',
        'معاوية',
        'مقيبلة',
        'مكر',
        'منشية الزبدة',
        'مولادا',
        'ميسر',
        'نتانيا',
        'نتانياا',
        'نتانيااا',
        'نحف',
        'نين',
        'هرتسيليا',
        'واد سلامة',
        'وادي الجوز',
        'وادي الحمام',
        'وادي سلامه',
        'وادي عارة',
        'يافا',
        'يافة الناصرة',
        'يانوح',
        'يركا',
        'כפר סבא'
      ]
    },
    allowOtherCity: { type: Boolean, default: true }
  }
});

// Payments configuration (server-side; clientId may be exposed, secret must not be)
settingsSchema.add({
  payments: {
    paypal: {
      enabled: { type: Boolean, default: false },
      mode: { type: String, enum: ['sandbox', 'live'], default: 'sandbox' },
      clientId: { type: String, default: '' },
      secret: { type: String, default: '' }
    },
    // Visibility / availability flags for each checkout payment option
    visibility: {
      card: { type: Boolean, default: true },      // credit/debit card (local form)
      cod: { type: Boolean, default: true },       // cash on delivery
      paypal: { type: Boolean, default: true }     // controls showing PayPal option in addition to paypal.enabled
    }
  }
});

// Create default settings or migrate existing ones
settingsSchema.statics.createDefaultSettings = async function() {
  try {
    const settings = await this.findOne();
    if (!settings) {
      // No settings exist, create default ones
      await this.create({});
      console.log('Default store settings created successfully');
    } else {
      // Settings exist, check if we need to add new theme fields
  let needsUpdate = false;
  const updateData = {};
      
      // Check for missing theme fields and add defaults
      if (!settings.primaryColor) {
        updateData.primaryColor = '#3b82f6';
        needsUpdate = true;
      }
      if (!settings.secondaryColor) {
        updateData.secondaryColor = '#64748b';
        needsUpdate = true;
      }
      if (!settings.accentColor) {
        updateData.accentColor = '#f59e0b';
        needsUpdate = true;
      }
      if (!settings.textColor) {
        updateData.textColor = '#1f2937';
        needsUpdate = true;
      }
      if (!settings.backgroundColor) {
        updateData.backgroundColor = '#ffffff';
        needsUpdate = true;
      }
      if (!settings.fontFamily) {
        updateData.fontFamily = 'Inter, system-ui, sans-serif';
        needsUpdate = true;
      }
      if (!settings.productGridStyle) {
        updateData.productGridStyle = 'standard';
        needsUpdate = true;
      }
      if (typeof settings.showColorFilter === 'undefined') {
        updateData.showColorFilter = true;
        needsUpdate = true;
      }
      // Ensure new nav style fields exist
      const ensureField = (k, val) => { if (typeof settings[k] === 'undefined') { updateData[k] = val; needsUpdate = true; } };
      ensureField('navCategoryFontColor', '');
      ensureField('navCategoryFontSize', 'medium');
      ensureField('navPanelFontColor', '');
      ensureField('navPanelColumnActiveBgColor', '');
      ensureField('navPanelAccentColor', '');
      ensureField('navPanelHeaderColor', '');
  ensureField('searchBorderColor', '');
  // Ensure scroll-to-top fields exist
  ensureField('scrollTopBgColor', '');
  ensureField('scrollTopTextColor', '');
  ensureField('scrollTopHoverBgColor', '');
  ensureField('scrollTopPingColor', '');
      if (!settings.productCardStyle) {
        updateData.productCardStyle = 'modern';
        needsUpdate = true;
      }
      if (!settings.headerIcons) {
        updateData.headerIcons = {
          showLanguage: true,
          showCurrency: true,
          showSearch: true,
          showWishlist: true,
          showCart: true,
          showAccount: true
        };
        needsUpdate = true;
      }
      if (typeof settings.headerBackgroundColor === 'undefined') {
        updateData.headerBackgroundColor = '';
        needsUpdate = true;
      }
      if (typeof settings.headerTextColor === 'undefined') {
        updateData.headerTextColor = '';
        needsUpdate = true;
      }
      if (!settings.headerIconVariants) {
        updateData.headerIconVariants = {
          cart: 'shoppingBag',
          wishlist: 'heart'
        };
        needsUpdate = true;
      }
      if (!settings.headerIconAssets) {
        updateData.headerIconAssets = {
          cart: '',
          wishlist: '',
          account: '',
          search: '',
          language: '',
          currency: ''
        };
        needsUpdate = true;
      }
      // Ensure socialLinks.whatsapp exists
      if (!settings.socialLinks || typeof settings.socialLinks.whatsapp === 'undefined') {
        updateData.socialLinks = {
          ...(settings.socialLinks || {}),
          whatsapp: ''
        };
        needsUpdate = true;
      }
      // Ensure hero autoplay exists
      if (typeof settings.heroAutoplayMs === 'undefined') {
        updateData.heroAutoplayMs = 5000;
        needsUpdate = true;
      }
      // Ensure new ATC color fields exist (added after initial deployments)
      if (typeof settings.atcBgColor === 'undefined') {
        updateData.atcBgColor = '';
        needsUpdate = true;
      }
      if (typeof settings.atcTextColor === 'undefined') {
        updateData.atcTextColor = '';
        needsUpdate = true;
      }
      if (typeof settings.atcHoverBgColor === 'undefined') {
        updateData.atcHoverBgColor = '';
        needsUpdate = true;
      }
      // Ensure apiBaseUrl field exists
      if (typeof settings.apiBaseUrl === 'undefined') {
        updateData.apiBaseUrl = 'http://localhost:5000';
        needsUpdate = true;
      }
      // Ensure payments.paypal exists
      if (!settings.payments || !settings.payments.paypal) {
        updateData.payments = {
          ...(settings.payments || {}),
          paypal: {
            enabled: false,
            mode: 'sandbox',
            clientId: '',
            secret: ''
          },
          visibility: {
            card: true,
            cod: true,
            paypal: true
          }
        };
        needsUpdate = true;
      }
      // Ensure payments.visibility exists if paypal existed previously
      if (settings.payments && !settings.payments.visibility) {
        updateData.payments = {
          ...(updateData.payments || settings.payments),
          visibility: {
            card: true,
            cod: true,
            paypal: true
          }
        };
        needsUpdate = true;
      }
      // Ensure googleAuth exists
      if (!settings.googleAuth) {
        updateData.googleAuth = { enabled: false, clientId: '' };
        needsUpdate = true;
      }

      // Migrate legacy checkoutForm.cities (English defaults) to new Arabic/Hebrew list
      try {
        const legacyMarkers = ['Jerusalem', 'Ramallah', 'Nablus', 'Hebron'];
        const shouldMigrateCities = !settings.checkoutForm ||
          !Array.isArray(settings.checkoutForm.cities) ||
          settings.checkoutForm.cities.length === 0 ||
          settings.checkoutForm.cities.some(c => legacyMarkers.includes(String(c)));
        if (shouldMigrateCities) {
          const newCities = [
            'ابو قويدر','الجولان','الريحانية','الظهرية','ام الفحم','بديا','بيت شيمش','جفعات شموئل','جولس','حزمه','حسنيه','خضيرة','دير رافات','راس علي','رحوفوت','رمانه','رموت هشفيم','صندله','طيرة الكرمل','عين الاسد','عين حوض','كريات اتا','كسرى سميع','لهافيم','معليا','معلي افريم','نهاريا','نوف هجليل','هود هشارون','يوكنعام','ירושלים','الضفة الغربية','منطقة ابو غوش','الداخل','قرى الخليل','قباطية','اريحا','العيزرية','الزعيم','يطا','بيت لحم','الخليل','طوباس','طولكرم','سلفيت','ابو غوش','جنين','قلقيلية','ابو ديس','عين رافا','حيفا','عناتا','سخنين','ضواحي بيت لحم','مخيم شعفاط','ضواحي القدس','السواحرة الشرقية','إم الفحم','البيرة','عين نقوبا','كفر عقب','غزة','ضواحي رام الله','الرام','رام الله','نابلس','ابطن','ابو اسنان','ابو تلول','ابو سنان','ابو قرينات','اريال','اشدود','اشكلون','اعبلين','اكسال','البعنه','البعينة نجيدات','البقيعة','البلدة القديمة أبواب','التله الفرنسيه','الثوري ابوطور','الجش','الجولان','الرامة','الرامه','الرملة','الرينه','الزرازير','الشبلة','الشيخ جراح','الشيخ دنون','الضاحية','الطور','الطيبة','الطيبة الزعبية','الطيرة','العزير','العيسويه','الغجر','الفريديس','القدس','الكعبية','اللد','اللقية','المركز','المزرعة','المزرعه','المشهد','المشيرفه','المغار','الناصرة','الناصره العليا','الناعورة','النقب','النين','ام الغنم','ام القطف','ام بطين','اور يهودا','ايلات','بات يام','بار يعكوف','باقة الغربية','برطعة','بسمة طبعون','بقعاتا','بني براك','بيت جان','بيتح تكفا','بيت حنينا','بيت صفافا','بير السبع','بير السكة','بير المشاش','بير المكسور','ترشيحا','تل ابيب','تل السبع','تل عراد','جبل المكبر','جت','جت الجليل','جديدة','جديده المكر','جسر الزرقاء','جلجوليا','جلجولية','جنوب','حجاجره','حرفيش','حريش','حورة','حولون','خوالد','دالية الكرمل','دبورية','دير الاسد','دير حنا','ديمونا','راس العامود','رعنانا','رمات جان','رمات خوڤاڤ','رهط','روش هعاين','رومانه','ريشون لتسيون','زلفة','زيمر','ساجور','سالم','سلوان','سولم','شارع يافا','شبلي','شعب','شعفاط','شفاعمر','شفاعمرو','شقيب السلام','شمال بعيد','شمال قريب','شمال وسط','صفد','صور باهر','ضميده','طباش','طبريا','طرعان','طمرة','طمرة الزعبية','طوبا الزنجريه','عارة','عرابة','عرابه','عراد','عرب العرامشة','عرب الهيب','عرعرة (الشمال)','عرعره النقب','عسفيا','عطروت','عفولة','عكا','عيلبون','عيلوط','عين السهلة','عين قينيا','عين ماهل','فريديس','فسوطه','قرية دريجات','قصر السر','قلنسوة','كابول','كرمئيل','كريات اونو','كريات شمونه','كسيفه','كعيبة','كفر برا','كفر سميع','كفر قاسم','كفرقرع','كفر قرع','كفر كما','كفر كنا','كفر مصر','كفر مندا','كفر ياسيف','كمانة','كوكب ابو الهيجا','كيبوتس دان','مثلث','مجد الكروم','مجدل شمس','مسعدة','مشيرفة','مصمص','معاوية','مقيبلة','مكر','منشية الزبدة','مولادا','ميسر','نتانيا','نتانياا','نتانيااا','نحف','نين','هرتسيليا','واد سلامة','وادي الجوز','وادي الحمام','وادي سلامه','وادي عارة','يافا','يافة الناصرة','يانوح','يركا','כפר סבא'
          ];
          updateData.checkoutForm = {
            ...(settings.checkoutForm || {}),
            cities: newCities,
            allowOtherCity: typeof settings.checkoutForm?.allowOtherCity === 'boolean' ? settings.checkoutForm.allowOtherCity : true,
            showEmail: !!settings.checkoutForm?.showEmail,
            showLastName: !!settings.checkoutForm?.showLastName,
            showSecondaryMobile: !!settings.checkoutForm?.showSecondaryMobile,
            showCountry: !!settings.checkoutForm?.showCountry
          };
          needsUpdate = true;
        }
      } catch (e) {
        console.warn('CheckoutForm cities migration skipped:', e.message);
      }
      
      if (needsUpdate) {
        await this.findByIdAndUpdate(settings._id, updateData);
        console.log('Existing settings migrated with new theme fields');
      }
    }
  } catch (error) {
    console.error('Error creating/migrating settings:', error);
  }
};

const Settings = mongoose.model('Settings', settingsSchema);

export default Settings;