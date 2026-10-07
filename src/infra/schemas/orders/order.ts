/** A line of an order, stored in the orders.items jsonb column. */
export interface OrderItem {
  productId: string;
  quantity: number;
  /** Unit price at the time of the order, in cents. */
  price: number;
}
