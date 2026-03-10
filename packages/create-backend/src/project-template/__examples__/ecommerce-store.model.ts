/**
 * E-commerce Store Data Model
 *
 * A complete e-commerce platform with:
 * - Product catalog with variants
 * - Shopping cart and orders
 * - Inventory management
 * - Customer reviews and ratings
 * - Payment processing
 * - Shipping and tracking
 *
 * Features demonstrated:
 * - Complex product variants (size, color, etc.)
 * - Order state machine
 * - Inventory tracking
 * - Financial calculations
 * - Multi-step workflows
 * - Audit trails
 *
 * To use this model:
 * 1. Copy to your project
 * 2. Run: npm run generate __examples__/ecommerce-store.model.ts
 * 3. Integrate payment provider (Stripe, etc.)
 * 4. Set up shipping provider
 * 5. Configure tax calculations
 */

import { DataModelSpecification } from '../functions/src/generator/types';

export const EcommerceStoreModel: DataModelSpecification = {
  entities: {
    Customer: {
      fields: {
        email: {
          type: 'email',
          unique: true,
          required: true,
        },
        firstName: {
          type: 'string',
          required: true,
        },
        lastName: {
          type: 'string',
          required: true,
        },
        phone: {
          type: 'phone',
          required: false,
        },
        stripeCustomerId: {
          type: 'string',
          unique: true,
          required: false,
        },
        defaultShippingAddressId: {
          type: 'reference',
          entity: 'Address',
          required: false,
        },
        defaultBillingAddressId: {
          type: 'reference',
          entity: 'Address',
          required: false,
        },
        totalSpent: {
          type: 'number',
          default: 0,
        },
        orderCount: {
          type: 'number',
          default: 0,
        },
        loyaltyPoints: {
          type: 'number',
          default: 0,
        },
        marketingOptIn: {
          type: 'boolean',
          default: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        addresses: {
          type: 'one-to-many',
          entity: 'Address',
          foreignKey: 'customerId',
        },
        orders: {
          type: 'one-to-many',
          entity: 'Order',
          foreignKey: 'customerId',
        },
        cart: {
          type: 'one-to-one',
          entity: 'Cart',
          foreignKey: 'customerId',
        },
        reviews: {
          type: 'one-to-many',
          entity: 'Review',
          foreignKey: 'customerId',
        },
      },
      access: {
        create: ['public'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        email: 'Must be a valid email',
        phone: 'Must be a valid phone number',
      },
      businessRules: [
        'Email must be verified before placing orders',
        'Customer data must be encrypted at rest',
        'Deleted customers have their PII anonymized',
      ],
      indexes: [
        { fields: ['email'], unique: true },
        { fields: ['stripeCustomerId'], unique: true },
        { fields: ['totalSpent'] },
      ],
    },

    Address: {
      fields: {
        customerId: {
          type: 'reference',
          entity: 'Customer',
          required: true,
        },
        addressLine1: {
          type: 'string',
          required: true,
        },
        addressLine2: {
          type: 'string',
          required: false,
        },
        city: {
          type: 'string',
          required: true,
        },
        state: {
          type: 'string',
          required: true,
        },
        postalCode: {
          type: 'string',
          required: true,
        },
        country: {
          type: 'string',
          required: true,
        },
        isDefault: {
          type: 'boolean',
          default: false,
        },
        isValidated: {
          type: 'boolean',
          default: false,
        },
      },
      relationships: {
        customer: {
          type: 'many-to-one',
          entity: 'Customer',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        postalCode: 'Must be valid for country',
      },
      businessRules: [
        'Addresses are validated using Google Maps API',
        'Only one default address per customer',
      ],
      indexes: [
        { fields: ['customerId'] },
      ],
    },

    Product: {
      fields: {
        name: {
          type: 'string',
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        description: {
          type: 'text',
          required: true,
        },
        shortDescription: {
          type: 'string',
          required: false,
        },
        basePrice: {
          type: 'number',
          required: true,
        },
        compareAtPrice: {
          type: 'number',
          required: false,
        },
        costPerItem: {
          type: 'number',
          required: false,
        },
        sku: {
          type: 'string',
          unique: true,
          required: false,
        },
        barcode: {
          type: 'string',
          required: false,
        },
        status: {
          type: 'enum',
          values: ['draft', 'active', 'archived'],
          default: 'draft',
        },
        categoryId: {
          type: 'reference',
          entity: 'Category',
          required: true,
        },
        brandId: {
          type: 'reference',
          entity: 'Brand',
          required: false,
        },
        taxable: {
          type: 'boolean',
          default: true,
        },
        weight: {
          type: 'number',
          required: false,
        },
        weightUnit: {
          type: 'enum',
          values: ['g', 'kg', 'oz', 'lb'],
          default: 'kg',
        },
        requiresShipping: {
          type: 'boolean',
          default: true,
        },
        hasVariants: {
          type: 'boolean',
          default: false,
        },
        totalInventory: {
          type: 'number',
          default: 0,
        },
        viewCount: {
          type: 'number',
          default: 0,
        },
        salesCount: {
          type: 'number',
          default: 0,
        },
        averageRating: {
          type: 'number',
          default: 0,
        },
        reviewCount: {
          type: 'number',
          default: 0,
        },
        isFeatured: {
          type: 'boolean',
          default: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        category: {
          type: 'many-to-one',
          entity: 'Category',
        },
        brand: {
          type: 'many-to-one',
          entity: 'Brand',
          optional: true,
        },
        variants: {
          type: 'one-to-many',
          entity: 'ProductVariant',
          foreignKey: 'productId',
        },
        images: {
          type: 'one-to-many',
          entity: 'ProductImage',
          foreignKey: 'productId',
        },
        reviews: {
          type: 'one-to-many',
          entity: 'Review',
          foreignKey: 'productId',
        },
        collections: {
          type: 'many-to-many',
          entity: 'Collection',
          through: 'ProductCollection',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      validation: {
        name: 'Must be 3-200 characters',
        basePrice: 'Must be greater than 0',
        weight: 'Must be positive number',
      },
      businessRules: [
        'Products with variants cannot have direct inventory',
        'Draft products are not visible to customers',
        'Products cannot be deleted if they have order history',
        'Price changes are logged for audit',
      ],
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['sku'], unique: true },
        { fields: ['categoryId', 'status'] },
        { fields: ['status', 'isFeatured'] },
      ],
    },

    ProductVariant: {
      fields: {
        productId: {
          type: 'reference',
          entity: 'Product',
          required: true,
        },
        sku: {
          type: 'string',
          unique: true,
          required: true,
        },
        barcode: {
          type: 'string',
          required: false,
        },
        price: {
          type: 'number',
          required: true,
        },
        compareAtPrice: {
          type: 'number',
          required: false,
        },
        costPerItem: {
          type: 'number',
          required: false,
        },
        option1: {
          type: 'string',
          required: false,
        },
        option2: {
          type: 'string',
          required: false,
        },
        option3: {
          type: 'string',
          required: false,
        },
        inventoryQuantity: {
          type: 'number',
          default: 0,
        },
        inventoryPolicy: {
          type: 'enum',
          values: ['deny', 'continue'],
          default: 'deny',
        },
        weight: {
          type: 'number',
          required: false,
        },
        imageId: {
          type: 'reference',
          entity: 'ProductImage',
          required: false,
        },
        isAvailable: {
          type: 'boolean',
          default: true,
        },
        position: {
          type: 'number',
          default: 0,
        },
      },
      relationships: {
        product: {
          type: 'many-to-one',
          entity: 'Product',
        },
        image: {
          type: 'many-to-one',
          entity: 'ProductImage',
          optional: true,
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      validation: {
        price: 'Must be greater than 0',
        inventoryQuantity: 'Cannot be negative',
      },
      businessRules: [
        'SKU must be unique across all variants',
        'Inventory changes are tracked for audit',
        'Low stock alerts are sent when inventory < threshold',
      ],
      indexes: [
        { fields: ['productId'] },
        { fields: ['sku'], unique: true },
      ],
    },

    Category: {
      fields: {
        name: {
          type: 'string',
          unique: true,
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        description: {
          type: 'text',
          required: false,
        },
        parentId: {
          type: 'reference',
          entity: 'Category',
          required: false,
        },
        imageUrl: {
          type: 'url',
          required: false,
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
        productCount: {
          type: 'number',
          default: 0,
        },
        position: {
          type: 'number',
          default: 0,
        },
      },
      relationships: {
        parent: {
          type: 'many-to-one',
          entity: 'Category',
          optional: true,
        },
        children: {
          type: 'one-to-many',
          entity: 'Category',
          foreignKey: 'parentId',
        },
        products: {
          type: 'one-to-many',
          entity: 'Product',
          foreignKey: 'categoryId',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['slug'], unique: true },
        { fields: ['parentId'] },
      ],
    },

    Brand: {
      fields: {
        name: {
          type: 'string',
          unique: true,
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        description: {
          type: 'text',
          required: false,
        },
        logoUrl: {
          type: 'url',
          required: false,
        },
        websiteUrl: {
          type: 'url',
          required: false,
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
      },
      relationships: {
        products: {
          type: 'one-to-many',
          entity: 'Product',
          foreignKey: 'brandId',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['slug'], unique: true },
      ],
    },

    Cart: {
      fields: {
        customerId: {
          type: 'reference',
          entity: 'Customer',
          required: false, // Null for guest carts
        },
        sessionId: {
          type: 'string',
          required: false, // For guest sessions
        },
        subtotal: {
          type: 'number',
          default: 0,
        },
        tax: {
          type: 'number',
          default: 0,
        },
        shipping: {
          type: 'number',
          default: 0,
        },
        total: {
          type: 'number',
          default: 0,
        },
        itemCount: {
          type: 'number',
          default: 0,
        },
        currency: {
          type: 'string',
          default: 'USD',
        },
        expiresAt: {
          type: 'timestamp',
          required: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        customer: {
          type: 'many-to-one',
          entity: 'Customer',
          optional: true,
        },
        items: {
          type: 'one-to-many',
          entity: 'CartItem',
          foreignKey: 'cartId',
          cascadeDelete: true,
        },
      },
      access: {
        create: ['public'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      businessRules: [
        'Guest carts expire after 7 days',
        'Customer carts never expire',
        'Cart totals are recalculated on every update',
        'Out-of-stock items are automatically removed',
      ],
      indexes: [
        { fields: ['customerId'], unique: true },
        { fields: ['sessionId'] },
        { fields: ['expiresAt'] },
      ],
    },

    CartItem: {
      fields: {
        cartId: {
          type: 'reference',
          entity: 'Cart',
          required: true,
        },
        productId: {
          type: 'reference',
          entity: 'Product',
          required: true,
        },
        variantId: {
          type: 'reference',
          entity: 'ProductVariant',
          required: false,
        },
        quantity: {
          type: 'number',
          required: true,
        },
        price: {
          type: 'number',
          required: true,
        },
        subtotal: {
          type: 'number',
          required: true,
        },
      },
      relationships: {
        cart: {
          type: 'many-to-one',
          entity: 'Cart',
        },
        product: {
          type: 'many-to-one',
          entity: 'Product',
        },
        variant: {
          type: 'many-to-one',
          entity: 'ProductVariant',
          optional: true,
        },
      },
      access: {
        create: ['self', 'admin'],
        read: ['self', 'admin'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        quantity: 'Must be greater than 0',
      },
      indexes: [
        { fields: ['cartId'] },
        { fields: ['productId'] },
      ],
    },

    Order: {
      fields: {
        orderNumber: {
          type: 'string',
          unique: true,
          required: true,
        },
        customerId: {
          type: 'reference',
          entity: 'Customer',
          required: true,
        },
        status: {
          type: 'enum',
          values: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
          default: 'pending',
        },
        paymentStatus: {
          type: 'enum',
          values: ['pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed'],
          default: 'pending',
        },
        fulfillmentStatus: {
          type: 'enum',
          values: ['unfulfilled', 'partially_fulfilled', 'fulfilled'],
          default: 'unfulfilled',
        },
        shippingAddressId: {
          type: 'reference',
          entity: 'Address',
          required: true,
        },
        billingAddressId: {
          type: 'reference',
          entity: 'Address',
          required: true,
        },
        subtotal: {
          type: 'number',
          required: true,
        },
        tax: {
          type: 'number',
          required: true,
        },
        shipping: {
          type: 'number',
          required: true,
        },
        discount: {
          type: 'number',
          default: 0,
        },
        total: {
          type: 'number',
          required: true,
        },
        currency: {
          type: 'string',
          default: 'USD',
        },
        stripePaymentIntentId: {
          type: 'string',
          required: false,
        },
        notes: {
          type: 'text',
          required: false,
        },
        customerNotes: {
          type: 'text',
          required: false,
        },
        confirmedAt: {
          type: 'timestamp',
          required: false,
        },
        shippedAt: {
          type: 'timestamp',
          required: false,
        },
        deliveredAt: {
          type: 'timestamp',
          required: false,
        },
        cancelledAt: {
          type: 'timestamp',
          required: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        customer: {
          type: 'many-to-one',
          entity: 'Customer',
        },
        shippingAddress: {
          type: 'many-to-one',
          entity: 'Address',
        },
        billingAddress: {
          type: 'many-to-one',
          entity: 'Address',
        },
        items: {
          type: 'one-to-many',
          entity: 'OrderItem',
          foreignKey: 'orderId',
        },
        shipments: {
          type: 'one-to-many',
          entity: 'Shipment',
          foreignKey: 'orderId',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['self', 'admin'],
        update: ['admin'],
        delete: ['admin'],
      },
      validation: {
        total: 'Must be greater than 0',
      },
      businessRules: [
        'Order numbers are auto-generated and sequential',
        'Orders cannot be deleted, only cancelled',
        'Cancelled orders release inventory',
        'Order status changes are logged for audit',
        'Customers are notified of status changes',
      ],
      indexes: [
        { fields: ['orderNumber'], unique: true },
        { fields: ['customerId', 'createdAt'] },
        { fields: ['status', 'createdAt'] },
        { fields: ['paymentStatus'] },
      ],
    },

    OrderItem: {
      fields: {
        orderId: {
          type: 'reference',
          entity: 'Order',
          required: true,
        },
        productId: {
          type: 'reference',
          entity: 'Product',
          required: true,
        },
        variantId: {
          type: 'reference',
          entity: 'ProductVariant',
          required: false,
        },
        productName: {
          type: 'string',
          required: true,
        },
        variantTitle: {
          type: 'string',
          required: false,
        },
        sku: {
          type: 'string',
          required: false,
        },
        quantity: {
          type: 'number',
          required: true,
        },
        price: {
          type: 'number',
          required: true,
        },
        subtotal: {
          type: 'number',
          required: true,
        },
        tax: {
          type: 'number',
          default: 0,
        },
        total: {
          type: 'number',
          required: true,
        },
      },
      relationships: {
        order: {
          type: 'many-to-one',
          entity: 'Order',
        },
        product: {
          type: 'many-to-one',
          entity: 'Product',
        },
        variant: {
          type: 'many-to-one',
          entity: 'ProductVariant',
          optional: true,
        },
      },
      access: {
        create: ['admin'],
        read: ['self', 'admin'],
        update: ['admin'],
        delete: ['admin'],
      },
      businessRules: [
        'Product details are snapshotted at order time',
        'Price changes do not affect existing orders',
      ],
      indexes: [
        { fields: ['orderId'] },
      ],
    },

    Shipment: {
      fields: {
        orderId: {
          type: 'reference',
          entity: 'Order',
          required: true,
        },
        trackingNumber: {
          type: 'string',
          required: false,
        },
        carrier: {
          type: 'string',
          required: false,
        },
        trackingUrl: {
          type: 'url',
          required: false,
        },
        status: {
          type: 'enum',
          values: ['pending', 'in_transit', 'out_for_delivery', 'delivered', 'failed'],
          default: 'pending',
        },
        shippedAt: {
          type: 'timestamp',
          required: false,
        },
        estimatedDeliveryAt: {
          type: 'timestamp',
          required: false,
        },
        deliveredAt: {
          type: 'timestamp',
          required: false,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        order: {
          type: 'many-to-one',
          entity: 'Order',
        },
      },
      access: {
        create: ['admin'],
        read: ['self', 'admin'],
        update: ['admin'],
        delete: ['admin'],
      },
      businessRules: [
        'Customers are notified when shipment is created',
        'Tracking updates are fetched from carrier API',
        'Delivery confirmation updates order status',
      ],
      indexes: [
        { fields: ['orderId'] },
        { fields: ['trackingNumber'] },
      ],
    },

    Review: {
      fields: {
        productId: {
          type: 'reference',
          entity: 'Product',
          required: true,
        },
        customerId: {
          type: 'reference',
          entity: 'Customer',
          required: true,
        },
        rating: {
          type: 'number',
          required: true,
        },
        title: {
          type: 'string',
          required: false,
        },
        content: {
          type: 'text',
          required: true,
        },
        status: {
          type: 'enum',
          values: ['pending', 'approved', 'rejected'],
          default: 'pending',
        },
        isVerifiedPurchase: {
          type: 'boolean',
          default: false,
        },
        helpfulCount: {
          type: 'number',
          default: 0,
        },
        createdAt: {
          type: 'timestamp',
          required: true,
        },
        updatedAt: {
          type: 'timestamp',
          required: true,
        },
      },
      relationships: {
        product: {
          type: 'many-to-one',
          entity: 'Product',
        },
        customer: {
          type: 'many-to-one',
          entity: 'Customer',
        },
      },
      access: {
        create: ['authenticated'],
        read: ['public'],
        update: ['self', 'admin'],
        delete: ['self', 'admin'],
      },
      validation: {
        rating: 'Must be between 1 and 5',
        content: 'Must be 10-2000 characters',
      },
      businessRules: [
        'Customers can only review products they purchased',
        'One review per customer per product',
        'Reviews affect product average rating',
      ],
      indexes: [
        { fields: ['productId', 'status'] },
        { fields: ['customerId'] },
        { fields: ['productId', 'customerId'], unique: true },
      ],
    },

    Collection: {
      fields: {
        name: {
          type: 'string',
          unique: true,
          required: true,
        },
        slug: {
          type: 'string',
          unique: true,
          required: true,
        },
        description: {
          type: 'text',
          required: false,
        },
        imageUrl: {
          type: 'url',
          required: false,
        },
        isActive: {
          type: 'boolean',
          default: true,
        },
        isFeatured: {
          type: 'boolean',
          default: false,
        },
        position: {
          type: 'number',
          default: 0,
        },
      },
      relationships: {
        products: {
          type: 'many-to-many',
          entity: 'Product',
          through: 'ProductCollection',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['slug'], unique: true },
      ],
    },

    ProductImage: {
      fields: {
        productId: {
          type: 'reference',
          entity: 'Product',
          required: true,
        },
        url: {
          type: 'url',
          required: true,
        },
        altText: {
          type: 'string',
          required: false,
        },
        position: {
          type: 'number',
          default: 0,
        },
      },
      relationships: {
        product: {
          type: 'many-to-one',
          entity: 'Product',
        },
      },
      access: {
        create: ['admin'],
        read: ['public'],
        update: ['admin'],
        delete: ['admin'],
      },
      indexes: [
        { fields: ['productId', 'position'] },
      ],
    },

    ProductCollection: {
      fields: {
        productId: {
          type: 'reference',
          entity: 'Product',
          required: true,
        },
        collectionId: {
          type: 'reference',
          entity: 'Collection',
          required: true,
        },
        position: {
          type: 'number',
          default: 0,
        },
      },
      indexes: [
        { fields: ['productId', 'collectionId'], unique: true },
        { fields: ['collectionId', 'position'] },
      ],
    },
  },
};
