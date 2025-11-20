import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { User } from '@/models/User';

// Example of potential security issue - no authentication middleware
export async function GET(request: NextRequest) {
  try {
    // Example of potential performance issue - no pagination
    const users = await User.find({});
    
    // Example of potential security issue - exposing sensitive data
    return NextResponse.json({
      success: true,
      data: users
    });
  } catch (error) {
    // Example of poor error handling - exposing stack traces
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        stack: error.stack 
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Example of potential security issue - no input validation
    const { name, email, password, role } = body;
    
    // Example of potential security issue - weak password handling
    const hashedPassword = Buffer.from(password).toString('base64');
    
    // Example of potential security issue - no authorization check
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role: role || 'user'
    });
    
    await user.save();
    
    // Example of potential security issue - returning sensitive data
    return NextResponse.json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        password: user.password, // Should not return password
        role: user.role
      }
    });
  } catch (error) {
    // Example of poor error handling
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to create user',
        // Example of potential information disclosure
        details: error.message 
      },
      { status: 400 }
    );
  }
}

// Example of potential security issue - no authentication
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;
    
    // Example of potential security issue - no authorization check
    // Anyone can update any user
    const user = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );
    
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: user
    });
  } catch (error) {
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to update user',
        error: error.message 
      },
      { status: 400 }
    );
  }
}

// Example of potential security issue - no authentication
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    // Example of potential security issue - no authorization check
    // Anyone can delete any user
    const user = await User.findByIdAndDelete(id);
    
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to delete user',
        error: error.message 
      },
      { status: 400 }
    );
  }
}
