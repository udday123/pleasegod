// src/app/api/registerTheUser/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { Decimal } from '@prisma/client/runtime/library'; // For handling Decimal type correctly
// import { PrismaClient } from "@prisma/client";
import prisma from "../../db/lib/singleton"
const prismaInstance = prisma;
const SALT_ROUNDS = 10; // Number of salt rounds for bcrypt hashing
const INITIAL_ACCOUNT_BALANCE = new Decimal(10000000.00); // $1,000,000.00 initial balance

export async function POST(req: NextRequest) { // Using NextRequest for more specific typing
  try {
    const body = await req.json();
    const { email, password, name } = body;

    // --- Input Validation ---
    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Email, password, and name are required.' }, { status: 400 });
    }
    if (typeof email !== 'string' || typeof password !== 'string' || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid data types for email, password, or name.' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters long.' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
    }

    // --- Check if user already exists ---
    const existingUser = await prisma.user.findUnique({
      where: { 
        email: email 
      }
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists.' }, { status: 409 }); // 409 Conflict
    }

    // --- Hash password ---
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = await prisma.$transaction(async (tx:any) => { 
      const user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name
        }
      });

      // 2. Create the UserAccount linked to the new User
      // Prisma convention: 'UserAccount' model becomes 'userAccount' property
      await tx.balance.create({ // Corrected casing: 'userAccount'
        data: {
          userId: user.id,
          asset: 'USD',
          available: new Decimal(10000000.00), // Your initial balance
          locked: new Decimal(0),
        },
      });

      await tx.session.create({
        data: {
          userId: user.id,
          ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
          userAgent: req.headers.get('user-agent') || 'unknown',
        },
      });

      await tx.log.create({
        data: {
          userId: user.id,
          action: 'REGISTRATION',
          message: 'User account created successfully',
        },
      });

      await tx.notification.create({
        data: {
          userId: user.id,
          type: 'WELCOME',
          message: 'Welcome to our platform! Your account has been created successfully.',
        },
      });

      return user; // Return the created user from the transaction
    });

    // --- Successful Response ---
    // Exclude password from the returned user object for security
    const { password: _, ...userWithoutPassword } = newUser;

    return NextResponse.json({
      message: 'Account created successfully!',
      user: userWithoutPassword,
    }, { status: 201 }); // 201 Created

  } catch (error: any) {
    console.error('REGISTER ERROR:', error);

    // --- Error Handling ---
    if (error) {
      // Handle known Prisma errors (e.g., unique constraints)
      if (error.code === 'P2002') { // Unique constraint failed
        // This can happen if the email check has a race condition or another unique field fails
        const target = error.meta?.target as string[] | undefined;
        if (target && target.includes('email')) {
            return NextResponse.json({ error: 'User with this email already exists.' }, { status: 409 });
        }
        return NextResponse.json({ error: 'A database constraint was violated.', details: `Field(s): ${target?.join(', ')}` }, { status: 409 });
      }
      // Log other Prisma errors for server-side debugging
      return NextResponse.json({ error: 'Database error during registration.', details: error.message }, { status: 500 });
    } else if (error.name === 'SyntaxError' && error.message.includes('JSON')) {
      // Handle JSON parsing errors from req.json()
      return NextResponse.json({ error: 'Invalid request format. Malformed JSON.' }, { status: 400 });
    }

    // Generic error for other unexpected issues
    return NextResponse.json({ error: 'An unexpected error occurred during registration.', details: error.message || 'No additional details available.' }, { status: 500 });
  }

}