/**
 * Firebase Admin SDK Initialization
 * Centralized Firebase initialization for the backend boilerplate
 */

import { getApps, getApp, initializeApp, applicationDefault, App } from 'firebase-admin/app';
import { getAuth as adminGetAuth, Auth } from 'firebase-admin/auth';
import { getStorage as adminGetStorage, Storage } from 'firebase-admin/storage';
import { Firestore, getFirestore as adminGetFirestore } from 'firebase-admin/firestore';
import { logger } from './logger';

let firestoreInstance: Firestore | null = null;
let isInitialized = false;

/**
 * Initialize Firebase Admin SDK
 * Safe to call multiple times - only initializes once
 */
export function initializeFirebase(): App {
  if (!isInitialized) {
    try {
      // Check if already initialized (e.g., by Firebase Functions runtime)
      if (getApps().length === 0) {
        const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

        if (!projectId) {
          throw new Error('FIREBASE_PROJECT_ID or GCLOUD_PROJECT environment variable is required');
        }

        // Initialize with application default credentials in Cloud Functions
        // or with service account in local development
        initializeApp({
          projectId,
          credential: applicationDefault(),
        });

        logger.info('Firebase Admin SDK initialized', {
          projectId,
          environment: process.env.NODE_ENV,
        });
      }

      isInitialized = true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize Firebase Admin SDK', err);
      throw err;
    }
  }

  return getApp();
}

/**
 * Get Firestore instance
 * Initializes Firebase if not already initialized
 *
 * @returns Firestore instance
 */
export function getFirestore(): Firestore {
  if (!firestoreInstance) {
    // Ensure Firebase is initialized
    initializeFirebase();

    // Get Firestore instance
    firestoreInstance = adminGetFirestore();

    // Configure Firestore settings
    firestoreInstance.settings({
      ignoreUndefinedProperties: true,
    });

    logger.info('Firestore instance created', {
      emulator: !!process.env.FIRESTORE_EMULATOR_HOST,
    });
  }

  return firestoreInstance;
}

/**
 * Get Firebase Auth instance
 */
export function getAuth(): Auth {
  initializeFirebase();
  return adminGetAuth();
}

/**
 * Get Firebase Storage instance
 */
export function getStorage(): Storage {
  initializeFirebase();
  return adminGetStorage();
}

/**
 * Reset Firebase instances (useful for testing)
 */
export function resetFirebase(): void {
  firestoreInstance = null;
  isInitialized = false;
}

/**
 * Check if Firebase is initialized
 */
export function isFirebaseInitialized(): boolean {
  return isInitialized;
}
