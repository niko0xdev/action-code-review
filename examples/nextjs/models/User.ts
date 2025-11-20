import mongoose, { Schema, Document } from 'mongoose';

// Example of potential security issue - no password complexity requirements
interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema({
  name: {
    type: String,
    required: true,
    // Example of potential security issue - no input sanitization
    trim: true
  },
  email: {
    type: String,
    required: true,
    // Example of potential security issue - weak email validation
    match: /.+@.+\..+/,
    unique: true
  },
  password: {
    type: String,
    required: true,
    // Example of potential security issue - no minimum length requirement
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  }
}, {
  timestamps: true
});

// Example of potential performance issue - no indexes on frequently queried fields
// UserSchema.index({ email: 1 });

// Example of potential security issue - no password hashing middleware
// UserSchema.pre('save', async function(next) {
//   if (!this.isModified('password')) return next();
//   this.password = await bcrypt.hash(this.password, 12);
//   next();
// });

export const User = mongoose.model<IUser>('User', UserSchema);
