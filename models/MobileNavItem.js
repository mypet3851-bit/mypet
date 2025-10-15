import mongoose from 'mongoose';

// Mobile navigation item schema for configuring the Expo app bottom tabs via admin panel
// Keep it generic enough to support common icon sets from @expo/vector-icons
const mobileNavItemSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    enum: ['home', 'search', 'new', 'cart', 'wishlist', 'profile', 'custom'],
    default: 'custom'
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  routeName: {
    type: String,
    required: true,
    trim: true,
    // Example values: Home, Search, Wishlist, Cart, Profile
  },
  iconType: {
    type: String,
    enum: ['vector', 'image'],
    default: 'vector'
  },
  iconSet: {
    type: String,
    enum: ['Ionicons', 'MaterialIcons', 'MaterialCommunityIcons', 'Feather', 'Entypo', 'AntDesign', 'FontAwesome', 'FontAwesome5', 'Octicons', 'SimpleLineIcons', 'EvilIcons'],
    default: 'Ionicons'
  },
  iconName: {
    type: String,
    required: true,
    trim: true
  },
  iconImageUrl: {
    type: String,
    default: ''
  },
  order: {
    type: Number,
    default: 0,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  requiresAuth: {
    type: Boolean,
    default: false
  },
  // Optional deep link or URL (unused by app initially but can be helpful for custom actions)
  href: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

mobileNavItemSchema.index({ order: 1 });

const MobileNavItem = mongoose.model('MobileNavItem', mobileNavItemSchema);
export default MobileNavItem;
