/**
 * The guides: one for customers, one for riders, one for staff. Plain data, so a sentence can be changed here without touching a screen.
 * Every name of a button or a screen below is what is really written on it. If a screen is renamed, change it here too.
 * (The administrator's guide is not written yet.)
 *
 * They are written the way a person would say it: short sentences, contractions, not every comma in place. Spelling stays right, and the
 * safety sentences (never ask for a PIN, never hand over a parcel before the code) stay word for word.
 * A link is written [words people can read](/page). It goes to a page that really exists, and the words say where it goes.
 */
export type Block = { text: string } | { steps: string[] } | { bullets: string[] } | { note: string };
export type Entry = { id: string; q: string; a: Block[] };
export type Topic = { id: string; title: string; icon: string; intro?: string; entries: Entry[] };
export type Guide = { audience: "customer" | "rider" | "staff"; title: string; subtitle: string; topics: Topic[]; stuck: string };

/** A link is written [words](/page). This gives the words alone, for searching and for reading aloud where a link cannot be shown. */
export const plain = (s: string): string => s.replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, "$1");

const t = (text: string): Block => ({ text });
const steps = (...s: string[]): Block => ({ steps: s });
const bullets = (...b: string[]): Block => ({ bullets: b });
const note = (n: string): Block => ({ note: n });

export const CUSTOMER_GUIDE: Guide = {
  audience: "customer",
  title: "Help for shoppers",
  subtitle: "Ordering, paying, getting your order and what to do when something isn't right.",
  stuck: "Still stuck? Tap the chat button in the shop and tell us your order number (it looks like MOA-4801). We reply as soon as we can.",
  topics: [
    {
      id: "ordering",
      title: "Placing an order",
      icon: "bx-cart",
      entries: [
        { id: "how-to-order", q: "How do I order?", a: [steps("Open a product, pick the size or colour if it has them, and tap add to cart", "Open your cart, have a quick look, then go to checkout", "Fill in your details, share where we should deliver and pay with Mobile Money", "You'll see your order number, and you can follow it any time in [My orders](/orders)")] },
        { id: "cart-limit", q: "Why can I not add more of an item?", a: [t("We check the stock right at that moment for the size or colour you picked, so you can only add what's really there. If your cart says an item sold out it went while you were shopping, so take it out or pick another size. You can always [go back to the shop](/) and find something close.")] },
        { id: "checkout-fields", q: "What do I fill in at checkout?", a: [bullets("Your name", "Your phone number. The rider calls this one so use a number that's on and that you'll pick up", "Where to deliver. Share the exact spot on the map (that's best) or just type the address", "A time that suits you and a note if you like, for example second gate or blue door", "Your Mobile Money number, which is only used for the payment")] },
      ],
    },
    {
      id: "paying",
      title: "Paying",
      icon: "bx-wallet",
      entries: [
        { id: "how-to-pay", q: "How do I pay?", a: [t("With Mobile Money, so MTN MoMo or Airtel Money. After you tap pay a request pops up on your phone. Check the amount and approve it with your PIN."), note("We never ask for your PIN, not in the shop and not in chat")] },
        { id: "part-payment", q: "Can I pay only part of the amount?", a: [t("Nope. The request on your phone is always for the full total of your order and all you can do is approve it or not. If you don't approve, nothing is taken.")] },
        { id: "no-prompt", q: "The request did not come, or I did not approve it in time", a: [t("We hold your order for 15 minutes while it waits for payment. If it isn't paid by then it's cancelled and the items go back in the shop, and nothing is charged."), bullets("Check the Mobile Money number is right and your phone has network", "Open the order in [My orders](/orders) and it'll tell you what happened", "If the 15 minutes already passed just order again")] },
        { id: "low-balance", q: "It says my balance is too low", a: [t("Your Mobile Money account didn't have enough for the full amount so nothing was taken. Add some money and try the payment again. If we're no longer holding the order for you, just order again.")] },
        { id: "paid-twice", q: "I paid but it still shows as unpaid, or I paid twice", a: [t("Tap the chat button and tell us the order number and roughly when you paid. If you paid twice the extra payment goes back to your Mobile Money account.")] },
      ],
    },
    {
      id: "delivery",
      title: "Getting your order",
      icon: "bx-cycling",
      entries: [
        { id: "how-delivery-works", q: "How does delivery work?", a: [steps("You pay, and your order goes to the store that's nearest to you and has your items", "A rider takes it, collects it from the store and sets off. You'll see their first name on your order and a Call button", "When the rider is on the way your order page shows your delivery code", "You give the rider the code when you have your order in your hands. They type it in and the order is marked delivered")] },
        { id: "delivery-code", q: "What is the delivery code?", a: [t("It's a 4-digit code that shows on your order page only while your order is on its way. It's how we know your order really got to you."), bullets("Give it to the rider only when you are holding your order", "Never read it out over the phone and never give it to someone who isn't the rider at your door", "Five wrong tries lock the delivery to keep it safe, and the office can unlock it")] },
        { id: "no-code", q: "I cannot show the code (no battery, no phone)", a: [t("The rider can take a photo instead, of your order with the person who got it, right at your door. They have to say why and give the name of whoever received it, and the office checks the photo afterwards. It's only for when the code really can't be used.")] },
        { id: "store-line", q: "What is the store shown on a product page?", a: [t("Under the stock line you'll see the store that has the product in stock, for example MOA Mart Kigali, with one line under it that says Your order is sent from this store."), t("If more than one store has it we send your order from the one nearest to you. If your order needs items from two stores we bring them together first, so it can take a little longer.")] },
        { id: "rider-call", q: "Will the rider call me?", a: [t("Yes, on the phone number you gave at checkout, so keep it on while you wait.")] },
        { id: "privacy", q: "What does the rider see about me?", a: [t("Your name, phone number and delivery place, and only after they've collected your order. Riders never see what's inside it.")] },
      ],
    },
    {
      id: "location",
      title: "Showing us where you are",
      icon: "bx-map-pin",
      entries: [
        { id: "share-location", q: "How do I share my exact location?", a: [steps("At checkout tap Choose on the map (you can set the pin exactly) or Use my current location (quick, but your phone decides how exact it is)", "The map opens where you are if your phone already allows that. If not, tap the target button on the map", "Search for a building, shop or street, or tap the map, or drag it, until the pin is on your door", "Check the name under the map and tap Use this spot. You'll see Location saved, with Change and Remove if you change your mind"), note("You can also share or change the location later on your order page, until the order is delivered")] },
        { id: "map-tools", q: "What can the map do?", a: [bullets("It names the place under the pin as you move it", "The blue dot is where you are, and the circle around it shows how sure your phone is. It also tells you how far the pin is from you", "Tap anywhere to put the pin there. Pinch, scroll or double-tap to zoom, slide to move and let go to glide", "Satellite shows rooftops and landmarks and Map shows streets, so use whichever helps you recognise the place", "Tap the search box when it's empty to use your current location or pick a place you used before. Clear recent places forgets them")] },
        { id: "location-blocked", q: "The map cannot find me", a: [t("Your phone or browser isn't letting this site use your location. Allow location for this site in your browser settings, make sure location is on for your phone and try again. If it still doesn't work search for your building or street, or drag the map. The pin you set is what the rider uses.")] },
      ],
    },
    {
      id: "orders",
      title: "My orders, cancelling and refunds",
      icon: "bx-receipt",
      entries: [
        { id: "statuses", q: "What do the order statuses mean?", a: [bullets("Waiting for payment means we're holding your items for 15 minutes", "Payment received. We are preparing your order means it's paid and waiting for a rider or about to be collected", "Your order is on its way means a rider has collected it and your code is on the order page", "Delivered means it reached you", "The payment did not go through or The time to pay ran out means nothing was charged, so order again", "Cancelled means it was cancelled, and if you had paid a refund follows")] },
        { id: "cancel", q: "How do I cancel an order?", a: [t("If you haven't paid yet open the order in [My orders](/orders) and tap Cancel order. Nothing is charged and the items go back in the shop."), t("If you've already paid tap the chat button and tell us the order number. We'll cancel it for you and pay you back.")] },
        { id: "refund", q: "How do I get my money back?", a: [t("A refund goes back to the Mobile Money account you paid from. Your order page tells you where it is, either on its way or paid back. If it says the refund did not go through tap the chat button and we'll sort it out.")] },
        { id: "remove-order", q: "Can I remove an old order from my list?", a: [t("Yes, once it's delivered or cancelled. Open it and tap Remove this order from my list. It only tidies your list and we keep our records, so we can still help you with it. You can't remove an order while its refund is still on its way.")] },
      ],
    },
    {
      id: "reviews",
      title: "Reviews",
      icon: "bx-star",
      entries: [
        { id: "write-review", q: "How do I write a review?", a: [steps("Open your delivered order in [My orders](/orders) and tap Write a review beside the product. Or open the product page and tap Write a review under Ratings and reviews", "Choose 1 to 5 stars", "Write what you thought of the product", "Tap Post review"), note("Please don't put links or personal details in a review. Nobody is paid for a review. Your first name and profile photo are shown with your review")] },
        { id: "who-can-review", q: "Why can I not write a review?", a: [t("Only customers who received the product can review it, and that's what keeps the reviews on MOA Mart honest. You can review it once your order with it is delivered and you need to be [signed in](/login)."), t("If you don't see a Write a review button but the product was delivered to you, open the order and use the link there.")] },
        { id: "read-reviews", q: "How do I read reviews?", a: [bullets("The bars show how many reviews gave each number of stars. Tap a bar to see only those and tap it again to see all", "Sort by Most helpful, Newest, Highest rated or Lowest rated", "Every review says Verified purchase because only buyers can write one", "Tap Helpful if a review helped you. If one breaks the rules tap the three dots on it and choose Report review", "A reply from the store shows under the review it answers")] },
        { id: "edit-review", q: "Can I change or delete my review?", a: [t("Yes. Your review shows at the top as Your review with Edit and Delete. If you change it, it says edited. After deleting you can write a new one.")] },
        { id: "removed-review", q: "My review disappeared", a: [t("We only remove a review for spam, abusive language, personal information, not being about the product, or when we can't confirm it's genuine. We never remove a review for being negative."), t("If we remove yours we tell you why. Open the product page to see the reason, edit your review and it'll be looked at again.")] },
      ],
    },
    {
      id: "account",
      title: "Your account",
      icon: "bx-user-circle",
      entries: [
        { id: "sign-in", q: "How do I sign up or log in?", a: [t("With your email and a password (at least 8 characters) or with Google. Open the account button and choose Log in or Sign up, or go straight to the [log in page](/login).")] },
        { id: "password", q: "How do I change my password?", a: [t("Open the account menu, choose Account and use Change password. It's all on your [account page](/account).")] },
        { id: "photo", q: "How do I add a profile photo?", a: [t("Open your [account page](/account) and tap Change photo. Pick a picture, move it so your face is in the square and save. If you signed in with Google your Google photo shows until you add your own.")] },
        { id: "wishlist", q: "What is the heart on a product?", a: [t("It saves the product to your wishlist, and you'll find it again in Account under Wishlist.")] },
        { id: "alerts-list", q: "Where do I see my notifications?", a: [t("The bell shows what's new about your orders, and the full list is on your [notifications page](/notifications). Open one to jump straight to the order.")] },
      ],
    },
  ],
};

export const RIDER_GUIDE: Guide = {
  audience: "rider",
  title: "Rider guide",
  subtitle: "Taking orders, collecting, delivering with the code and what to do when it doesn't go to plan.",
  stuck: "Something that isn't covered here, or a delivery is stuck? Call the office. They can unlock a code, move an order or decide what happens next.",
  topics: [
    {
      id: "start",
      title: "Getting started",
      icon: "bx-play-circle",
      entries: [
        { id: "the-app", q: "What is on the screen?", a: [t("When you sign in you land in the rider app and there are four tabs at the bottom."), bullets("Available shows paid orders nobody has taken yet", "My deliveries is what you need to collect and deliver", "Done today is what you've finished today", "Alerts are messages for you like new order, taken away, cancelled, unlocked and moved")] },
        { id: "keep-open", q: "Why must I keep the app open?", a: [t("The app does not send notifications to your phone. You only see new orders, offers and alerts while the app is open, so keep it open while you work and tap the Refresh button at the top if you want to check right away."), t("It also shares your location while it's open so the office can see where you are and offers can go to the nearest rider. When you deliver it records where you were so we can check the delivery.")] },
        { id: "online", q: "What is the Online switch?", a: [t("If the shop offers orders to riders automatically you'll see a switch at the top to go Online (ready for orders) or Offline. Go Online when you start and Offline when you stop. If it isn't there just take orders yourself from Available.")] },
      ],
    },
    {
      id: "orders",
      title: "Getting an order",
      icon: "bx-package",
      entries: [
        { id: "available", q: "How do I take an order?", a: [t("Open Available. Each card shows the order number, where to collect it and roughly how far it is. You don't see the customer's address yet. Tap Take this delivery to make it yours and it moves to My deliveries, where you collect it first.")] },
        { id: "offers", q: "I got an offer with a countdown", a: [t("When orders are offered automatically the nearest free rider who is Online sees a New order for you card with a countdown. Tap Accept before it runs out. If you don't it goes to the next rider so nobody waits around."), bullets("Be Online and keep the app open", "Your location has to be recent. If the app can't find you it says so, and you won't be offered orders until it can")] },
        { id: "missing", q: "An order I expected is not in the list", a: [bullets("Someone else took it", "It isn't paid yet", "It's waiting for goods to be moved to its warehouse and it shows up as soon as the office marks them received", "It was offered to another rider for a short time")] },
      ],
    },
    {
      id: "collecting",
      title: "Collecting from the warehouse",
      icon: "bx-store",
      entries: [
        { id: "collect", q: "How do I collect parcels?", a: [steps("Open My deliveries. Parcels at the same warehouse are one Collect card", "Use Navigate to get to the warehouse, or call it", "At the warehouse tick each parcel you've received", "Slide to confirm with Slide: I have the parcel")] },
        { id: "slide", q: "Why does a tap do nothing on the slide?", a: [t("That's on purpose. Sliding tells the customer their order is on the way and you can't take that back by mistake, so slide all the way across.")] },
      ],
    },
    {
      id: "delivering",
      title: "Delivering",
      icon: "bx-cycling",
      entries: [
        { id: "stops", q: "What do I see after collecting?", a: [t("Your stops, nearest first. The first one is open and shows the customer's name, the place, any note and a timeline. Only now do you see the customer's details."), bullets("Navigate opens your maps app with the route from the warehouse to the customer", "The round button calls the customer", "More has other ways to go, like Navigate from where I am now, and the two cases further down")] },
        { id: "code", q: "How do I finish a delivery?", a: [steps("Hand over the parcel but ask for the code first", "Tap I am here: enter the code", "Type the customer's 4-digit code and when it's right the delivery is done"), note("Never give the parcel before you have the code")] },
        { id: "wrong-code", q: "The code is wrong, or the delivery is locked", a: [t("The app tells you how many tries are left. After too many wrong codes the delivery locks to keep it safe. Call the office and they'll unlock it, or use the photo way below if the customer really can't give the code.")] },
        { id: "photo-way", q: "The customer cannot give the code", a: [t("Open More and choose The customer can't give the code. It only works for a real reason and it needs"), bullets("The reason, like no phone or battery, can't find or read the code, or someone else is receiving it", "The name of the person who got the parcel", "A photo of the parcel with that person, taken now at the door (not older than about 25 minutes)", "Your location, which the app records"), t("The office checks it afterwards.")] },
        { id: "cannot-deliver", q: "I cannot deliver this order", a: [t("Open More and choose I can't deliver this order, then say why. Maybe the customer didn't answer, the address is wrong or unclear, they refused it or it's something else. Keep the parcel with you until the office calls because they decide what happens next.")] },
      ],
    },
    {
      id: "trouble",
      title: "When something is wrong",
      icon: "bx-help-circle",
      entries: [
        { id: "location-trouble", q: "The app cannot find my location", a: [t("Allow location for this site in your browser settings, make sure location is on for your phone and be outdoors if you can. The app tells you which of these is the problem, and you can still finish the delivery with the code."), note("If the app says the page isn't secure ask the office. Location only works on a secure (https) page")] },
        { id: "order-moved", q: "An order was moved or taken away", a: [t("The office can move an order to another warehouse before you collect it, or take it off you. You get an alert and the order leaves or changes in My deliveries. If you were already heading to the old warehouse, check the new one in the alert.")] },
        { id: "alerts", q: "What do the alerts mean?", a: [bullets("New order for you means an order was given or offered to you", "Taken away means it's not yours anymore", "Cancelled means the customer or the shop cancelled it so don't deliver it", "Unlocked means the office unlocked a delivery that was locked", "Moved means the place to collect it changed")] },
      ],
    },
  ],
};

export const STAFF_GUIDE: Guide = {
  audience: "staff",
  title: "Staff guide",
  subtitle: "Running a day with orders, deliveries, stores, stock, chats and notifications. Administrators have more tools and those aren't covered here.",
  stuck: "If a paid order needs cancelling, a refund failed or anything else only an administrator can do, tell an administrator and give them the order number.",
  topics: [
    {
      id: "day",
      title: "A day, step by step",
      icon: "bx-sun",
      entries: [
        { id: "routine", q: "What do I check, and in what order?", a: [steps("Start at the [Overview](/admin) and look at the strip at the top (orders to dispatch, chats waiting, products that need stock)", "Go to [Orders](/admin/orders) and open To dispatch. Every paid order should be with a rider or on its way to one", "Check [Riders](/admin/riders) for Deliveries that need a look and see who's on the road", "Answer the chat that's waited longest first in the [Inbox](/admin/inbox)", "Restock what's Running low or Out of stock in [Inventory](/admin/inventory)", "Finish with [Notifications](/admin/notifications) and read what needs attention")] },
      ],
    },
    {
      id: "orders",
      title: "Orders",
      icon: "bx-receipt",
      entries: [
        { id: "order-stages", q: "What do the stages mean?", a: [bullets("Awaiting payment means the customer has 15 minutes to pay and there's nothing for you to do", "To dispatch means it's paid and not with a rider yet", "Waiting for items means it's paid but some of its goods are in another warehouse (more in Stock and warehouses below)", "On the way means a rider has collected it", "Delivered and Cancelled need no explaining")] },
        { id: "find-orders", q: "How do I find an order from a certain day?", a: [t("On [Orders](/admin/orders) use the day buttons under the search box. Tap Today, Yesterday, Last 7 days or Last 30 days, or tap Pick dates to choose a day or a range on the calendar. The list is grouped by day and each day folds up when you tap its name. The little day buttons above the list take you straight to a day.")] },
        { id: "open-order", q: "What can I do on an order?", a: [t("Tap an order to open it. The sheet shows the customer, the delivery and the items, plus a Delivery section with the history. From there you can"), bullets("Print the delivery note", "Show the phone number and call the customer (it's hidden until you ask)", "Open the address in maps", "Cancel an order that hasn't been paid")] },
        { id: "assign", q: "How does an order get a rider?", a: [t("Riders take paid orders from their own list, or the shop offers them automatically (the administrator chooses). You can still step in from the order's Delivery section"), bullets("Assign lets you pick a rider", "Take the rider off, or Put it back in the list for any rider, before it's collected", "Change the warehouse it's collected from, before it's collected, and the stock moves with it")] },
        { id: "locked", q: "A rider says the code is locked", a: [t("Open the order. If the rider made five wrong tries you'll see Unlock the code. Use it and tell the rider. If the customer truly can't give the code the rider can use the photo way, and the order gets marked for you to check.")] },
        { id: "check-photo", q: "A delivery was made without the code", a: [t("It shows as Delivered without a code: check the photo on the Riders page and on the order. Open the proof photo and look at it, does it show the parcel with a person at the right place? If it's fine tap I checked the photo: all is well. If not, tell an administrator.")] },
        { id: "no-code-override", q: "I need to mark an order delivered myself", a: [t("In the order's Delivery section use Mark delivered without the code… and write why. It's kept in the order's history.")] },
        { id: "cancel", q: "Can I cancel an order?", a: [t("You can cancel an order that hasn't been paid. A paid order can only be cancelled and refunded by an administrator, so tell them the order number. If a customer asks you in chat to cancel a paid order, do exactly that.")] },
        { id: "remove", q: "How do I tidy delivered and cancelled orders?", a: [t("Open the order and tap Remove from the list…, or select a few and use More then Remove from the list…. They leave the Orders list but nothing is erased, so Analytics, Finance and the customer still have them. An order whose refund is still to be paid can't be removed.")] },
        { id: "select", q: "How do I work on several orders at once?", a: [t("Tap Select, tick the orders and use the bar at the bottom to print delivery notes, export, cancel unpaid ones or remove finished ones.")] },
      ],
    },
    {
      id: "riders",
      title: "Riders",
      icon: "bx-cycling",
      entries: [
        { id: "riders-page", q: "What is on the Riders page?", a: [t("Open [Riders](/admin/riders) to see")  , bullets("Your team, and who's on the road", "Deliveries that need a look, which are failed ones and ones delivered without a code", "The rules and automatic assignment, which an administrator sets")] },
        { id: "failed", q: "A rider could not deliver", a: [t("It shows under Deliveries that need a look with the reason (no answer, wrong address, refused or something else). Call the customer and decide together whether to try again, or tell an administrator if it has to be cancelled and refunded. The rider keeps the parcel until you call.")] },
      ],
    },
    {
      id: "stores",
      title: "Stores",
      icon: "bx-store-alt",
      entries: [
        { id: "stores-page", q: "What is on the Stores page?", a: [t("[Stores](/admin/stores) is where the places orders are sent from live. Shoppers see them as stores and riders collect from them. Each one shows its address, phone, logo and how many items it holds."), bullets("Which store is the Default", "Whether a store is open or Closed", "What happens when an order needs items from two stores, which an administrator sets")] },
        { id: "stores-admin", q: "How do I add, edit or remove a store?", a: [t("That's for administrators. They tap Add a warehouse to add one, and use the three dots on a store to edit it, close it, make it the default or remove it. Editing a store is also where its logo goes. A store that still holds stock, or has orders on the way, can't be removed."), t("If you spot a wrong address or phone number, tell an administrator.")] },
      ],
    },
    {
      id: "stock",
      title: "Stock and warehouses",
      icon: "bx-box",
      entries: [
        { id: "inventory", q: "How do I change stock?", a: [steps("Open [Inventory](/admin/inventory) and find the product (search, or use the tabs Needs attention, Out of stock and Running low)", "Tap Adjust stock", "If the shop has several warehouses choose which one at the top", "Change the numbers, pick why (for example New stock arrived) and Save"), note("Every change is recorded with who made it and why")] },
        { id: "where-stock", q: "Where is a product's stock?", a: [t("When there's more than one warehouse each product shows small labels like Kigali 12 · Musanze 3. The total is what customers see.")] },
        { id: "move", q: "I moved goods between warehouses", a: [t("In the product's Adjust stock sheet open Move some to another warehouse, say how many and tap Move it. The total doesn't change. Do it when you really carry the goods so the numbers stay true.")] },
        { id: "waiting-items", q: "An order says Waiting for items", a: [t("A customer's order needs goods that are in another warehouse. The order is filled from one warehouse (the nearest one that can) and the missing items have to come from another. You're told when it's paid."), steps("Open the order. The orange box lists what to move, how many and from where", "Carry the goods to the warehouse named in the box", "Tap It has arrived next to each item"), t("Only then can a rider take the order. Until you do, riders don't see it and it can't be assigned.")] },
      ],
    },
    {
      id: "inbox",
      title: "Chats and notifications",
      icon: "bx-conversation",
      entries: [
        { id: "answering-chats", q: "How do I answer customers?", a: [t("Open the [Inbox](/admin/inbox). The chat that's waited longest is first, so open it and write. Use the saved replies button for common answers, use Assign to me so nobody else answers the same chat and tap Close when it's done (you can Reopen it). The tabs All, Needs reply, Mine and Closed help you find the right one."), note("Never ask a customer for a PIN or password")] },
        { id: "notifications", q: "What are the notifications for?", a: [t("The bell tells you what needs attention, like new orders, low stock, chats, deliveries that need a look and items that have to move for an order. Open [Notifications](/admin/notifications) to search, filter, jump to a day and mark things read. On a phone you can also swipe a popup sideways to get rid of it, it stays in the list.")] },
        { id: "analytics", q: "What can I see in Analytics?", a: [t("[Analytics](/admin/analytics) has counts, stock and support figures. Money figures are for administrators.")] },
      ],
    },
    {
      id: "reviews",
      title: "Reviews",
      icon: "bx-star",
      entries: [
        { id: "reviews-page", q: "What is on the Reviews page?", a: [t("[Reviews](/admin/reviews) shows every review customers have written, newest first, with tabs for Needs a reply, Low ratings, Reported, Hidden and All. Only customers whose order was delivered can write one so each review is from a real buyer."), t("You're told when a customer gives 1 or 2 stars and when someone reports a review.")] },
        { id: "reply-review", q: "How do I reply to a review?", a: [steps("Open Reviews and find it (the Needs a reply tab lists the ones nobody has answered)", "Tap Reply, write your answer and tap Save reply", "The reply shows publicly under the review and the customer is told"), t("Thank them, say sorry if it fell short and say what you'll do. A calm reply to a bad review helps other shoppers more than a good review does. You can Edit reply or Remove reply later.")] },
        { id: "hide-review", q: "When can I hide a review?", a: [t("Only for one of five reasons, which are spam or advertising, abusive or offensive language, personal information, not being about the product, or looking fake. You can never hide a review for being negative. It's against the rules of Google and of consumer law, and shoppers stop trusting a shop that hides bad reviews."), steps("Open the menu on the review and choose Hide review…", "Choose the reason and tap Hide review", "The customer is told why and can edit their review and write it again"), t("Use Show again to bring one back.")] },
        { id: "reported-review", q: "Someone reported a review", a: [t("Open the Reported tab and read the review and the reasons people gave. If it breaks the rules use Hide review…. If it doesn't use Dismiss reports and it stays."), t("A strong complaint about the product isn't a reason to hide a review.")] },
        { id: "low-rating", q: "A customer gave 1 or 2 stars", a: [t("Read it in the Low ratings tab and reply. If the problem is real, like a faulty item or a late delivery, contact the customer in the chat and put it right. Do not ask them to change or delete their review, and never offer anything in return for a review.")] },
      ],
    },
  ],
};

export const GUIDES = { customer: CUSTOMER_GUIDE, rider: RIDER_GUIDE, staff: STAFF_GUIDE } as const;

/** The plain words of one entry, for searching. */
export const textOf = (e: Entry): string =>
  plain([e.q, ...e.a.flatMap((b) => ("text" in b ? [b.text] : "note" in b ? [b.note] : "steps" in b ? b.steps : b.bullets))].join(" ")).toLowerCase();

/** Entries that contain every word typed, best first (a match in the question counts for more). Empty search: everything. */
export function searchGuide(guide: Guide, term: string): Array<{ topic: Topic; entry: Entry }> {
  const phrase = term.toLowerCase().trim().replace(/\s+/g, " ");
  const words = phrase.split(" ").filter((w) => w.length > 1);
  const all = guide.topics.flatMap((topic) => topic.entries.map((entry) => ({ topic, entry })));
  if (words.length === 0) return all;
  const score = (hay: string, q: string) => (hay.includes(phrase) ? 10 : 0) + (q.includes(phrase) ? 5 : 0) + words.filter((w) => q.includes(w)).length;
  return all
    .map((x) => ({ x, hay: textOf(x.entry), q: x.entry.q.toLowerCase() }))
    .filter(({ hay }) => words.every((w) => hay.includes(w)))
    .map((r, i) => ({ ...r, i, score: score(r.hay, r.q) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ x }) => x);
}
