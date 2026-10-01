# MOA Mart Express

Create a futuristic, minimalist, and fully responsive e-commerce web app called "MOA Mart" built with React, Vite, and Tailwind CSS. Focus strictly on frontend UI/UX design and mock data layout (I will connect Supabase backend later).

### Typography & Icons

- Fonts: "Poppins" for UI/headings and "Jost" for body copy/metadata.

- Icons: Use Boxicons v2 (https://v2.boxicons.com/).

### Color Palette & Visual Vibe

- Minimalist, futuristic aesthetic: High contrast, dark neutral background tones, clean neon/glassmorphism accents, smooth micro-interactions, subtle hover states, clean layout whitespace.

---

### Key Requirements & Views

#### 1. Client Landing & Products Page (Default View)

- All clients land directly on the Products Catalog page.

- Load realistic mock product images using Cloudinary URLs.

- Include a vast selection of mock products covering multiple categories: Clothing (all types), Shoes, Home Tools, Kitchen, Lighting, Electronics, Tech Gadgets, Toys, and Art.

- **Header:** Include the MOA Mart branding, a global Search Bar, Wishlist counter, Cart drawer, and a floating Support Chat button.

- **Search & Smart Feed Algorithm Simulation:** 

  - The default feed sorting must display:

    1. First 1.5 pages: Most clicked, most wishlisted, and most ordered products.

    2. 3rd page equivalent: Newest arrivals.

    3. Below 3rd page: Dynamic mixed product recommendation feed.

- **Collapsible Filter Bar:** Keep filters hidden by default in an accordion/drawer to maintain zero clutter. Toggle to reveal filter options for Category, Price Range, In-Stock status, and Ratings.

#### 2. Deep-Dive Product View (Modal or Detail Page)

- Exhaustive product detail layout supporting rich media and documentation.

- Features to include:

  - Multi-angle Cloudinary image gallery and video preview placeholder.

  - Interactive specs sheet, formatted bullet points, collapsible text sections, and external reference links.

  - Dynamic Stock Indicator: Real-time dynamic status badge (e.g., "In Stock", "Only 2 left", or "Out of Stock").

#### 3. WhatsApp Checkout Flow

- When a client clicks "Buy Now" or "Order via WhatsApp", trigger a pre-formatted WhatsApp message redirect to `+250785762690`.

- Format the WhatsApp message payload cleanly:

  - **Client Info:** Name, Phone Number, Delivery Location, Preferred Order Time.

  - **Product Info:** Product Name, Price, Direct Page Link, and Cloudinary Image Link.

#### 4. Live Support Chat Widget

- Floating chat box at the bottom right corner allowing seamless messaging between client and staff.

---

#### 5. Management / Admin Dashboard

Create a sleek sidebar navigation with the following views:

1. **Overview Dashboard:**

   - Visual summary widgets for Analytics, Live Inventory status, Financial performance, and Customer Sentiment/Satisfaction ratings.

2. **Analytics:**

   - Interactive metric charts with customizable time selection filters (Daily, Weekly, Monthly, YTD).

3. **Inventory:**

   - Real-time stock levels table with fast toggle states to mark products "In Stock" or "Out of Stock".

4. **Financials:**

   - Revenue streams, pending manual payments, and margin breakdown charts.

5. **Chats:**

   - Staff inbox to view and reply to live client support messages.

6. **Orders & WhatsApp Order Tracker:**

   - Orders list showing customer details and WhatsApp transaction logs.

   - **Manual Order Status Prompt:** Since orders are handled via WhatsApp text message, include an active notification banner/reminder prompt asking staff to manually update order fulfillment statuses (e.g., "Pending", "Confirmed", "Shipped", "Delivered").

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3a3a4e18-efc0-445a-9fcf-b9f590eccba4).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
