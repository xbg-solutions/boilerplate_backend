/**
 * Event Type Definitions
 * 
 * Strongly typed events for internal event bus.
 * Events decouple components and enable async workflows.
 */

export enum EventType {
  // User events
  USER_CREATED = 'user.created',
  USER_ADDED_TO_ACCOUNT = 'user.added_to_account',
  USER_REMOVED_FROM_ACCOUNT = 'user.removed_from_account',
  USER_UPDATED = 'user.updated',
  USER_DELETED = 'user.deleted',

  // Account events
  ACCOUNT_CREATED = 'account.created',
  ACCOUNT_OWNERSHIP_TRANSFERRED = 'account.ownership_transferred',
  ACCOUNT_UPDATED = 'account.updated',
  ACCOUNT_DELETED = 'account.deleted',

  // List events
  LIST_CREATED = 'list.created',
  LIST_UPDATED = 'list.updated',
  LIST_SHARED = 'list.shared',
  LIST_DELETED = 'list.deleted',

  // Item events
  ITEM_CREATED = 'item.created',
  ITEM_UPDATED = 'item.updated',
  ITEM_APPROVED = 'item.approved',
  ITEM_DENIED = 'item.denied',
  ITEM_CLAIMED = 'item.claimed',
  ITEM_UNCLAIMED = 'item.unclaimed',
  ITEM_DELETED = 'item.deleted',

  // Occasion events
  OCCASION_CREATED = 'occasion.created',
  OCCASION_UPDATED = 'occasion.updated',
  OCCASION_PASSED = 'occasion.passed',
  OCCASION_DELETED = 'occasion.deleted',

  // Contact events
  CONTACT_CREATED = 'contact.created',
  CONTACT_UPDATED = 'contact.updated',
  CONTACT_DELETED = 'contact.deleted',
  CONTACT_CONVERTED_TO_USER = 'contact.converted_to_user',

  // Address events
  ADDRESS_CREATED = 'address.created',
  ADDRESS_UPDATED = 'address.updated',
  ADDRESS_DELETED = 'address.deleted',

  // Claim events
  CLAIM_DELETED = 'claim.deleted',

  // Membership events
  MEMBERSHIP_ROLE_CHANGED = 'membership.role_changed',

  // Non-human user events
  NON_HUMAN_USER_CREATED = 'non_human_user.created',
  NON_HUMAN_USER_UPDATED = 'non_human_user.updated',
  NON_HUMAN_USER_DELETED = 'non_human_user.deleted',
  NON_HUMAN_USER_PERMISSIONS_UPDATED = 'non_human_user.permissions_updated',

  // Group gift events
  GROUP_GIFT_CREATED = 'group_gift.created',
  GROUP_GIFT_UPDATED = 'group_gift.updated',
  GROUP_GIFT_DELETED = 'group_gift.deleted',

  // Reminder subscription events
  REMINDER_SUBSCRIPTION_CREATED = 'reminder_subscription.created',
  REMINDER_SUBSCRIPTION_UPDATED = 'reminder_subscription.updated',
  REMINDER_SUBSCRIPTION_DELETED = 'reminder_subscription.deleted',

  // List update subscription events
  LIST_UPDATE_SUBSCRIPTION_CREATED = 'list_update_subscription.created',
  LIST_UPDATE_SUBSCRIPTION_UPDATED = 'list_update_subscription.updated',
  LIST_UPDATE_SUBSCRIPTION_DELETED = 'list_update_subscription.deleted',

  // Image events
  IMAGE_UPLOADED = 'item.image.uploaded',
  PROFILE_IMAGE_UPLOADED = 'user.profile_image.uploaded',
  FILE_UPLOADED = 'file.uploaded', // Generic file upload
  FILE_DELETED = 'file.deleted',

  // Notification events
  NOTIFICATION_SENT = 'notification.sent',
  NOTIFICATION_FAILED = 'notification.failed',

  // External data change events (for audit logging)
  EXTERNAL_DATA_CHANGE = 'external.data.change',

  // Well wish events
  WELL_WISH_CREATED = 'well_wish.created',
  WELL_WISH_UPDATED = 'well_wish.updated',
  WELL_WISH_APPROVED = 'well_wish.approved',
  WELL_WISH_DELETED = 'well_wish.deleted',

  // Thank you note events
  THANK_YOU_NOTE_CREATED = 'thank_you_note.created',
  THANK_YOU_NOTE_SENT = 'thank_you_note.sent',
  THANK_YOU_NOTE_UPDATED = 'thank_you_note.updated',
  THANK_YOU_NOTE_ACKNOWLEDGED = 'thank_you_note.acknowledged',
  THANK_YOU_NOTE_DELETED = 'thank_you_note.deleted',

  // Join request events
  JOIN_REQUEST_CREATED = 'join_request.created',
  JOIN_REQUEST_APPROVED = 'join_request.approved',
  JOIN_REQUEST_DENIED = 'join_request.denied',
}

/**
 * Base event payload interface
 */
export interface BaseEventPayload {
  timestamp?: Date;
  [key: string]: unknown;
}

/**
 * Specific event payload types
 */
export interface UserCreatedPayload extends BaseEventPayload {
  userUID: string;
  accountUID: string;
  referredBy?: string;
}

export interface UserDeletedPayload extends BaseEventPayload {
  userUID: string;
}

export interface UserAddedToAccountPayload extends BaseEventPayload {
  membershipUID: string;
  userUID: string;
  accountUID: string;
  role: string;
  addedBy: string;
}

export interface UserRemovedFromAccountPayload extends BaseEventPayload {
  membershipUID: string;
  userUID: string;
  accountUID: string;
  role: string;
  removedBy: string;
}

export interface AccountOwnershipTransferredPayload extends BaseEventPayload {
  accountUID: string;
  oldOwnerUserUID: string;
  newOwnerUserUID: string;
  transferredBy: string;
}

export interface MembershipRoleChangedPayload extends BaseEventPayload {
  membershipUID: string;
  userUID: string;
  accountUID: string;
  oldRole: string;
  newRole: string;
  updatedBy: string;
}

export interface ListCreatedPayload extends BaseEventPayload {
  listUID: string;
  listOwnerUID: string;
  accountUID: string;
}

export interface ListSharedPayload extends BaseEventPayload {
  listUID: string;
  sharedWith: string[]; // contactUIDs
  sharedBy: string; // userUID
}

export interface ItemClaimedPayload extends BaseEventPayload {
  claimUID: string;
  itemUID: string;
  listUID: string;
  contactUID: string;
  claimType: 'full_purchase' | 'group_contribution';
  claimedBy: string;
}

export interface ItemUnclaimedPayload extends BaseEventPayload {
  claimUID: string;
  itemUID: string;
  listUID: string;
  contactUID: string;
  unclaimedBy: string;
}

export interface ClaimDeletedPayload extends BaseEventPayload {
  claimUID: string;
  itemUID: string;
  listUID: string;
  deletedBy: string;
}

export interface ItemCreatedPayload extends BaseEventPayload {
  itemUID: string;
  listUID: string;
  createdBy: string;
  accountUID?: string;
}

export interface ItemApprovedPayload extends BaseEventPayload {
  itemUID: string;
  approvedBy: string;
  listOwnerUID: string;
}

export interface ImageUploadedPayload extends BaseEventPayload {
  itemUID: string;
  imageUrl: string;
  uploadedBy: string;
  filePath?: string;
}

export interface ProfileImageUploadedPayload extends BaseEventPayload {
  userUID: string;
  imageUrl: string;
  storagePath: string;
}

export interface FileUploadedPayload extends BaseEventPayload {
  filePath: string;
  contentType?: string;
  size?: number;
  bucket?: string;
}

export interface FileDeletedPayload extends BaseEventPayload {
  filePath: string;
}

export interface ExternalDataChangePayload extends BaseEventPayload {
  source: 'firestore' | 'auth' | 'storage';
  collection?: string;
  documentId?: string;
  operation?: string;
  userId?: string;
  filePath?: string;
}

export interface OccasionPassedPayload extends BaseEventPayload {
  occasionUID: string;
  accountUID: string;
  associatedLists: string[];
}

export interface ContactCreatedPayload extends BaseEventPayload {
  contactUID: string;
  accountUID: string;
  createdBy: string;
}

export interface ContactUpdatedPayload extends BaseEventPayload {
  contactUID: string;
  accountUID: string;
  updatedBy: string;
}

export interface ContactDeletedPayload extends BaseEventPayload {
  contactUID: string;
  accountUID: string;
  deletedBy: string;
  deletionType: 'soft' | 'hard';
}

export interface ContactConvertedPayload extends BaseEventPayload {
  contactUID: string;
  userUID: string;
  accountUID: string;
}

export interface AddressCreatedPayload extends BaseEventPayload {
  addressUID: string;
  accountUID: string;
  createdBy: string;
}

export interface AddressUpdatedPayload extends BaseEventPayload {
  addressUID: string;
  accountUID: string;
  updatedBy: string;
}

export interface AddressDeletedPayload extends BaseEventPayload {
  addressUID: string;
  accountUID: string;
  deletedBy: string;
  deletionType: 'soft' | 'hard';
}

export interface NonHumanUserCreatedPayload extends BaseEventPayload {
  nonHumanUserUID: string;
  accountUID: string;
  name: string;
  type: string | null;
  createdBy: string;
}

export interface NonHumanUserUpdatedPayload extends BaseEventPayload {
  nonHumanUserUID: string;
  accountUID: string;
  updatedBy: string;
}

export interface NonHumanUserDeletedPayload extends BaseEventPayload {
  nonHumanUserUID: string;
  accountUID: string;
  deletedBy: string;
  deletionType: 'soft' | 'hard';
}

export interface NonHumanUserPermissionsUpdatedPayload extends BaseEventPayload {
  nonHumanUserUID: string;
  accountUID: string;
  updatedBy: string;
}

export interface WellWishCreatedPayload extends BaseEventPayload {
  wellWishUID: string;
  senderUID: string;
  recipientUID: string;
  occasionUID: string;
  visibility: string;
  createdBy: string;
}

export interface WellWishUpdatedPayload extends BaseEventPayload {
  wellWishUID: string;
  updatedBy: string;
}

export interface WellWishApprovedPayload extends BaseEventPayload {
  wellWishUID: string;
  approvedBy: string;
}

export interface WellWishDeletedPayload extends BaseEventPayload {
  wellWishUID: string;
  deletedBy: string;
}

export interface ThankYouNoteCreatedPayload extends BaseEventPayload {
  thankYouNoteUID: string;
  senderUID: string;
  recipientUID: string;
  occasionUID: string;
  status: string;
  createdBy: string;
}

export interface ThankYouNoteSentPayload extends BaseEventPayload {
  thankYouNoteUID: string;
  senderUID: string;
  recipientUID: string;
  occasionUID: string;
  sentBy: string;
}

export interface ThankYouNoteUpdatedPayload extends BaseEventPayload {
  thankYouNoteUID: string;
  updatedBy: string;
}

export interface ThankYouNoteAcknowledgedPayload extends BaseEventPayload {
  thankYouNoteUID: string;
  acknowledgedBy: string;
}

export interface ThankYouNoteDeletedPayload extends BaseEventPayload {
  thankYouNoteUID: string;
  deletedBy: string;
}

/**
 * Event payload map for type safety
 */
export interface EventPayloadMap {
  [EventType.USER_CREATED]: UserCreatedPayload;
  [EventType.USER_ADDED_TO_ACCOUNT]: UserAddedToAccountPayload;
  [EventType.USER_REMOVED_FROM_ACCOUNT]: UserRemovedFromAccountPayload;
  [EventType.ACCOUNT_OWNERSHIP_TRANSFERRED]: AccountOwnershipTransferredPayload;
  [EventType.MEMBERSHIP_ROLE_CHANGED]: MembershipRoleChangedPayload;
  [EventType.LIST_CREATED]: ListCreatedPayload;
  [EventType.LIST_SHARED]: ListSharedPayload;
  [EventType.ITEM_CLAIMED]: ItemClaimedPayload;
  [EventType.ITEM_UNCLAIMED]: ItemUnclaimedPayload;
  [EventType.CLAIM_DELETED]: ClaimDeletedPayload;
  [EventType.ITEM_APPROVED]: ItemApprovedPayload;
  [EventType.IMAGE_UPLOADED]: ImageUploadedPayload;
  [EventType.PROFILE_IMAGE_UPLOADED]: ProfileImageUploadedPayload;
  [EventType.FILE_UPLOADED]: FileUploadedPayload;
  [EventType.FILE_DELETED]: FileDeletedPayload;
  [EventType.EXTERNAL_DATA_CHANGE]: ExternalDataChangePayload;
  [EventType.OCCASION_PASSED]: OccasionPassedPayload;
  [EventType.CONTACT_CREATED]: ContactCreatedPayload;
  [EventType.CONTACT_UPDATED]: ContactUpdatedPayload;
  [EventType.CONTACT_DELETED]: ContactDeletedPayload;
  [EventType.CONTACT_CONVERTED_TO_USER]: ContactConvertedPayload;
  [EventType.ADDRESS_CREATED]: AddressCreatedPayload;
  [EventType.ADDRESS_UPDATED]: AddressUpdatedPayload;
  [EventType.ADDRESS_DELETED]: AddressDeletedPayload;
  [EventType.NON_HUMAN_USER_CREATED]: NonHumanUserCreatedPayload;
  [EventType.NON_HUMAN_USER_UPDATED]: NonHumanUserUpdatedPayload;
  [EventType.NON_HUMAN_USER_DELETED]: NonHumanUserDeletedPayload;
  [EventType.NON_HUMAN_USER_PERMISSIONS_UPDATED]: NonHumanUserPermissionsUpdatedPayload;
  [EventType.WELL_WISH_CREATED]: WellWishCreatedPayload;
  [EventType.WELL_WISH_UPDATED]: WellWishUpdatedPayload;
  [EventType.WELL_WISH_APPROVED]: WellWishApprovedPayload;
  [EventType.WELL_WISH_DELETED]: WellWishDeletedPayload;
  [EventType.THANK_YOU_NOTE_CREATED]: ThankYouNoteCreatedPayload;
  [EventType.THANK_YOU_NOTE_SENT]: ThankYouNoteSentPayload;
  [EventType.THANK_YOU_NOTE_UPDATED]: ThankYouNoteUpdatedPayload;
  [EventType.THANK_YOU_NOTE_ACKNOWLEDGED]: ThankYouNoteAcknowledgedPayload;
  [EventType.THANK_YOU_NOTE_DELETED]: ThankYouNoteDeletedPayload;
  // Add more as needed
}