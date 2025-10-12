import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  text: {
    type: String,
    required: [true, 'Announcement text is required'],
    trim: true,
    maxLength: [100, 'Announcement text cannot exceed 100 characters']
  },
  icon: {
    type: String,
    required: [true, 'Icon name is required'],
    enum: ['Truck', 'Sparkles', 'Clock', 'CreditCard', 'Star', 'Gift', 'Heart', 'Tag'],
    default: 'Star'
  },
  fontSize: {
    type: String,
    enum: ['xs', 'sm', 'base', 'lg', 'xl'],
    default: 'sm'
  },
  textColor: {
    type: String,
    default: '#FFFFFF',
    validate: {
      validator: function(v) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
      },
      message: 'Invalid hex color code'
    }
  },
  backgroundColor: {
    type: String,
    default: '#4F46E5',
    validate: {
      validator: function(v) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
      },
      message: 'Invalid hex color code'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('Announcement', announcementSchema);