import type { OrderItem } from '../infra/schemas/orders/order.js';

export type { OrderItem };

export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  /** In cents. */
  total: number;
  status: 'placed' | 'cancelled';
}

export class PlaceOrderDto {
  userId: string;
  items: { productId: string; quantity: number }[];
}
