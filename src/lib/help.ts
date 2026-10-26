/**
 * The guides: one for customers, one for riders, one for staff. Plain data, so a sentence can be changed here without touching a screen.
 * Every name of a button or a screen below is what is really written on it. If a screen is renamed, change it here too.
 * (The administrator's guide is not written yet.)
 */
export type Block = { text: string } | { steps: string[] } | { bullets: string[] } | { note: string };
export type Entry = { id: string; q: string; a: Block[] };
export type Topic = { id: string; title: string; icon: string; intro?: string; entries: Entry[] };
export type Guide = { audience: "customer" | "rider" | "staff"; title: string; subtitle: string; topics: Topic[]; stuck: string };

const t = (text: string): Block => ({ text });
const steps = (...s: string[]): Block => ({ steps: s });
const bullets = (...b: string[]): Block => ({ bullets: b });
const note = (n: string): Block => ({ note: n });

export const CUSTOMER_GUIDE: Guide = {
  audience: "customer",
  title: "Help for shoppers",
  subtitle: "Ordering, paying, getting your order, and what to do when something is not right.",
  stuck: "Still stuck? Use the chat button in the shop and quote your order number (it looks like MOA-4801). We reply as soon as we can.",
  topics: [
    {
      id: "ordering",
      title: "Placing an order",
      icon: "bx-cart",
      entries: [
        { id: "how-to-order", q: "How do I order?", a: [steps("Open a product, choose its size or colour if it has them, and tap add to cart.", "Open your cart and check it, then go to checkout.", "Fill in your details, share where we should deliver, and pay with Mobile Money.", "We show your order number. You can follow it any time in My orders.")] },
        { id: "cart-limit", q: "Why can I not add more of an item?", a: [t("We check the stock at that moment, for the size or colour you chose. You can add only what is really there. If the cart says an item sold out, it went while you were shopping: remove it or choose another size.")] },
        { id: "checkout-fields", q: "What do I fill in at checkout?", a: [bullets("Your name.", "Your phone number. This is the number the rider calls, so use one that is on and that you will answer.", "Where to deliver: share the exact spot on the map (best), or type the address.", "A preferred time and a note, if you want (for example: second gate, blue door).", "Your Mobile Money number. This one is for the payment only.")] },
      ],
    },
    {
      id: "paying",
      title: "Paying",
      icon: "bx-wallet",
      entries: [
        { id: "how-to-pay", q: "How do I pay?", a: [t("With Mobile Money: MTN MoMo or Airtel Money. After you tap pay, a request appears on your phone. Check the amount, then approve it with your PIN."), note("We never ask for your PIN, in the shop or in chat.")] },
        { id: "part-payment", q: "Can I pay only part of the amount?", a: [t("No. The request on your phone is always for the full total of your order, and you can only approve it or not. Nothing is taken if you do not approve.")] },
        { id: "no-prompt", q: "The request did not come, or I did not approve it in time", a: [t("An order is held for you for 15 minutes while it waits for payment. If it is not paid by then, it is cancelled and the items go back in the shop. Nothing is charged."), bullets("Check that the Mobile Money number is right and that your phone has network.", "Open the order in My orders: it tells you what happened.", "If the 15 minutes passed, order again.")] },
        { id: "low-balance", q: "It says my balance is too low", a: [t("Your Mobile Money account did not have enough for the full amount, so nothing was taken. Add money and try the payment again. If the order is no longer held for you, order again.")] },
        { id: "paid-twice", q: "I paid but it still shows as unpaid, or I paid twice", a: [t("Use the chat button and quote the order number and the time you paid. If you paid twice, the extra payment is paid back to your Mobile Money account.")] },
      ],
    },
    {
      id: "delivery",
      title: "Getting your order",
      icon: "bx-cycling",
      entries: [
        { id: "how-delivery-works", q: "How does delivery work?", a: [steps("You pay. Your order is paid and goes to the warehouse that is nearest to you and has your items.", "A rider takes it, collects it from the warehouse and sets off. You see their first name on your order, and a Call button.", "When the rider is on the way, your order page shows your delivery code.", "You give the rider the code when you have your order in your hands. The rider types it in, and the order is marked delivered.")] },
        { id: "delivery-code", q: "What is the delivery code?", a: [t("A 4-digit code that appears on your order page only while your order is on its way. It is how we know your order really reached you."), bullets("Give it to the rider only when you are holding your order.", "Never read it out over the phone, and never to someone who is not the rider at your door.", "Five wrong tries lock the delivery for safety. The office can unlock it.")] },
        { id: "no-code", q: "I cannot show the code (no battery, no phone)", a: [t("The rider can take a photo instead: of your order with the person who received it, taken at your door. The rider must say why and give the name of whoever received it, and the office checks the photo afterwards. It is only for when the code cannot be used.")] },
        { id: "rider-call", q: "Will the rider call me?", a: [t("Yes, on the phone number you gave at checkout. Keep it on while you wait.")] },
        { id: "privacy", q: "What does the rider see about me?", a: [t("Your name, phone number and delivery place, and only after they have collected your order. Riders are never shown what is inside it.")] },
      ],
    },
    {
      id: "location",
      title: "Showing us where you are",
      icon: "bx-map-pin",
      entries: [
        { id: "share-location", q: "How do I share my exact location?", a: [steps("At checkout, tap Choose on the map (you can set the pin exactly), or Use my current location (quick, but your phone decides how exact it is).", "The map opens. It starts where you are, if your phone already allows that. If not, tap the target button on the map.", "Search for a building, shop or street, or tap the map, or drag it, until the pin is on your door.", "Check the name shown under the map, then tap Use this spot. You will see Location saved, with Change and Remove if you change your mind."), note("You can also share or change the location later, on your order page, until the order is delivered.")] },
        { id: "map-tools", q: "What can the map do?", a: [bullets("It names the place under the pin as you move it.", "Blue dot: where you are. The circle around it shows how sure your phone is. It also says how far the pin is from you.", "Tap anywhere to put the pin there. Pinch, scroll or double-tap to zoom. Slide to move, and let go to glide.", "Satellite shows rooftops and landmarks, and Map shows streets. Use whichever helps you recognise the place.", "Tap the search box when it is empty to use your current location, or to choose a place you used before. Clear recent places forgets them.")] },
        { id: "location-blocked", q: "The map cannot find me", a: [t("Your phone or browser is not letting this site use your location. Allow location for this site in your browser settings, make sure location is on for your phone, and try again. If it still does not work, search for your building or street, or drag the map. The pin you set is what the rider uses.")] },
      ],
    },
    {
      id: "orders",
      title: "My orders, cancelling and refunds",
      icon: "bx-receipt",
      entries: [
        { id: "statuses", q: "What do the order statuses mean?", a: [bullets("Waiting for payment: we hold your items for 15 minutes.", "Payment received. We are preparing your order: it is paid, and waiting for a rider or about to be collected.", "Your order is on its way: a rider has collected it. Your code is on the order page.", "Delivered: it reached you.", "The payment did not go through, or The time to pay ran out: nothing was charged. Order again.", "Cancelled: it was cancelled. If you had paid, a refund follows.")] },
        { id: "cancel", q: "How do I cancel an order?", a: [t("If you have not paid yet, open the order and tap Cancel order. Nothing is charged, and the items go back in the shop."), t("If you have paid, use the chat button and tell us the order number. We cancel it for you and pay you back.")] },
        { id: "refund", q: "How do I get my money back?", a: [t("A refund goes to the Mobile Money account you paid from. Your order page tells you where it is: on its way, or paid back. If it says the refund did not go through, use the chat button and we will fix it.")] },
        { id: "remove-order", q: "Can I remove an old order from my list?", a: [t("Yes, once it is delivered or cancelled: open it and tap Remove this order from my list. It only tidies your list. We keep our records, so we can still help you with it. You cannot remove an order while its refund is still on its way.")] },
      ],
    },
    {
      id: "account",
      title: "Your account",
      icon: "bx-user-circle",
      entries: [
        { id: "sign-in", q: "How do I sign up or log in?", a: [t("With your email and a password (at least 8 characters), or with Google. Open the account button, then choose Log in or Sign up.")] },
        { id: "password", q: "How do I change my password?", a: [t("Open the account menu, choose Account, and use Change password.")] },
        { id: "photo", q: "How do I add a profile photo?", a: [t("Open Account, then tap Change photo. Choose a picture, move it so your face is in the square, and save. If you signed in with Google, your Google photo shows until you add your own.")] },
        { id: "wishlist", q: "What is the heart on a product?", a: [t("It saves the product to your wishlist. You find it again in Account, under Wishlist.")] },
      ],
    },
  ],
};

export const RIDER_GUIDE: Guide = {
  audience: "rider",
  title: "Rider guide",
  subtitle: "Taking orders, collecting, delivering with the code, and what to do when it does not go to plan.",
  stuck: "Something not covered here, or a delivery is stuck? Call the office. They can unlock a code, move an order, or decide what happens next.",
  topics: [
    {
      id: "start",
      title: "Getting started",
      icon: "bx-play-circle",
      entries: [
        { id: "the-app", q: "What is on the screen?", a: [t("When you sign in you land in the rider app. There are four tabs at the bottom."), bullets("Available: paid orders nobody has taken yet.", "My deliveries: what you have to collect and deliver.", "Done today: what you have finished today.", "Alerts: messages for you (new order, taken away, cancelled, unlocked, moved).")] },
        { id: "keep-open", q: "Why must I keep the app open?", a: [t("The app does not send notifications to your phone. You see new orders, offers and alerts while the app is open. Keep it open while you work, and use the Refresh button at the top if you want to check at once."), t("It also shares your location while it is open, so the office can see where you are and offers can go to the nearest rider. When you deliver, it records where you were to check the delivery.")] },
        { id: "online", q: "What is the Online switch?", a: [t("If the shop offers orders to riders automatically, a switch at the top lets you go Online (ready for orders) or Offline. Go Online when you start and Offline when you stop. When it is not there, take orders yourself from Available.")] },
      ],
    },
    {
      id: "orders",
      title: "Getting an order",
      icon: "bx-package",
      entries: [
        { id: "available", q: "How do I take an order?", a: [t("Open Available. Each card shows the order number, where to collect it and roughly how far it is. You do not see the customer's address yet. Tap Take this delivery to make it yours. It moves to My deliveries, and you must collect it first.")] },
        { id: "offers", q: "I got an offer with a countdown", a: [t("When orders are offered automatically, the nearest free rider who is Online sees a New order for you card with a countdown. Tap Accept before it runs out. If you do not, it goes to the next rider, so no one is kept waiting."), bullets("Be Online and keep the app open.", "Your location must be recent. If the app cannot find you, it says so, and you are not offered orders until it can.")] },
        { id: "missing", q: "An order I expected is not in the list", a: [bullets("Someone else took it.", "It is not paid yet.", "It is waiting for goods to be moved to its warehouse. It appears as soon as the office marks them received.", "It was offered to another rider for a short time.")] },
      ],
    },
    {
      id: "collecting",
      title: "Collecting from the warehouse",
      icon: "bx-store",
      entries: [
        { id: "collect", q: "How do I collect parcels?", a: [steps("Open My deliveries. Parcels at the same warehouse are one Collect card.", "Use Navigate to go to the warehouse, or call it.", "At the warehouse, tick each parcel you have received.", "Slide to confirm: Slide: I have the parcel.")] },
        { id: "slide", q: "Why does a tap do nothing on the slide?", a: [t("On purpose. Sliding tells the customer their order is on the way, and you cannot take that back by mistake. Slide all the way across.")] },
      ],
    },
    {
      id: "delivering",
      title: "Delivering",
      icon: "bx-cycling",
      entries: [
        { id: "stops", q: "What do I see after collecting?", a: [t("Your stops, nearest first. The first one is open: it shows the customer's name, the place, any note, and a timeline. Only now do you see the customer's details."), bullets("Navigate opens your maps app with the route from the warehouse to the customer.", "The round button calls the customer.", "More has other ways: Navigate from where I am now, and the two cases below.")] },
        { id: "code", q: "How do I finish a delivery?", a: [steps("Hand over the parcel, but ask for the code first.", "Tap I am here: enter the code.", "Type the customer's 4-digit code. When it is right, the delivery is complete."), note("Never give the parcel before you have the code.")] },
        { id: "wrong-code", q: "The code is wrong, or the delivery is locked", a: [t("The app says how many tries are left. After too many wrong codes the delivery locks for safety. Call the office and they will unlock it, or use the photo way below if the customer truly cannot give the code.")] },
        { id: "photo-way", q: "The customer cannot give the code", a: [t("Open More, then The customer can't give the code. It only works for a real reason, and it needs:"), bullets("The reason: no phone or battery, cannot find or read the code, or someone else is receiving it.", "The name of the person who received the parcel.", "A photo of the parcel with that person, taken now at the door (not older than about 25 minutes).", "Your location, which the app records."), t("The office checks it afterwards.")] },
        { id: "cannot-deliver", q: "I cannot deliver this order", a: [t("Open More, then I can't deliver this order, and say why: the customer did not answer, the address is wrong or unclear, the customer refused it, or something else. Keep the parcel with you until the office calls. They decide what happens next.")] },
      ],
    },
    {
      id: "trouble",
      title: "When something is wrong",
      icon: "bx-help-circle",
      entries: [
        { id: "location-trouble", q: "The app cannot find my location", a: [t("Allow location for this site in your browser settings, make sure location is on for your phone, and be outdoors if you can. The app says which of these is the problem. The delivery can still be completed with the code."), note("If the app says the page is not secure, ask the office. Location only works on a secure (https) page.")] },
        { id: "order-moved", q: "An order was moved or taken away", a: [t("The office can move an order to another warehouse before you collect it, or take it off you. You get an alert, and the order leaves or changes in My deliveries. If you were already on your way to the old warehouse, check the new one in the alert.")] },
        { id: "alerts", q: "What do the alerts mean?", a: [bullets("New order for you: an order was given or offered to you.", "Taken away: it is no longer yours.", "Cancelled: the customer or the shop cancelled it. Do not deliver it.", "Unlocked: the office unlocked a delivery that was locked.", "Moved: the place to collect it changed.")] },
      ],
    },
  ],
};

export const STAFF_GUIDE: Guide = {
  audience: "staff",
  title: "Staff guide",
  subtitle: "Running a day: orders, deliveries, stock, chats and notifications. (Administrators have more tools; those are not covered here.)",
  stuck: "A paid order that needs cancelling, a refund that failed, or anything an administrator must do: tell an administrator and quote the order number.",
  topics: [
    {
      id: "day",
      title: "A day, step by step",
      icon: "bx-sun",
      entries: [
        { id: "routine", q: "What do I check, and in what order?", a: [steps("Overview: look at the strip at the top (orders to dispatch, chats waiting, products that need stock).", "Orders: open To dispatch. Every paid order should be with a rider or on its way to one.", "Riders: look at Deliveries that need a look, and who is on the road.", "Inbox: answer the chat that has waited longest first.", "Inventory: restock what is Running low or Out of stock.", "Notifications: read what needs attention.")] },
      ],
    },
    {
      id: "orders",
      title: "Orders",
      icon: "bx-receipt",
      entries: [
        { id: "order-stages", q: "What do the stages mean?", a: [bullets("Awaiting payment: the customer has 15 minutes to pay. Nothing to do.", "To dispatch: paid, and not yet with a rider.", "Waiting for items: paid, but some of its goods are in another warehouse. See Stock and warehouses below.", "On the way: a rider has collected it.", "Delivered, Cancelled.")] },
        { id: "open-order", q: "What can I do on an order?", a: [t("Tap an order to open it. The sheet shows the customer, the delivery and the items, and a Delivery section with the history. You can:"), bullets("Print the delivery note.", "Show the phone number and call the customer (the number is hidden until you ask).", "Open the address in maps.", "Cancel an order that has not been paid.")] },
        { id: "assign", q: "How does an order get a rider?", a: [t("Riders take paid orders from their own list, or the shop offers them automatically (the administrator chooses). You can still step in on the order's Delivery section:"), bullets("Assign: pick a rider.", "Take the rider off, or Put it back in the list for any rider, before it is collected.", "Change the warehouse it is collected from, before it is collected. The stock moves with it.")] },
        { id: "locked", q: "A rider says the code is locked", a: [t("Open the order. If the rider has made five wrong tries, Unlock the code appears. Use it, and tell the rider. If the customer truly cannot give the code, the rider can use the photo way, and the order is marked for you to check.")] },
        { id: "check-photo", q: "A delivery was made without the code", a: [t("It shows as Delivered without a code: check the photo on the Riders page and on the order. Open the proof photo and look: does it show the parcel with a person at the right place? If it is fine, tap I checked the photo: all is well. If not, tell an administrator.")] },
        { id: "no-code-override", q: "I need to mark an order delivered myself", a: [t("In the order's Delivery section, Mark delivered without the code…, and write why. It is kept in the order's history.")] },
        { id: "cancel", q: "Can I cancel an order?", a: [t("You can cancel an order that is unpaid. A paid order can only be cancelled and refunded by an administrator: tell them the order number. If a customer asks you in chat to cancel a paid order, do exactly that.")] },
        { id: "remove", q: "How do I tidy delivered and cancelled orders?", a: [t("Open the order and tap Remove from the list…, or select several and use More, then Remove from the list…. They leave the Orders list, and nothing is erased: Analytics, Finance and the customer still have them. An order whose refund is still to be paid cannot be removed.")] },
        { id: "select", q: "How do I work on several orders at once?", a: [t("Tap Select, tick the orders, then use the bar at the bottom: print delivery notes, export, cancel unpaid ones, or remove finished ones.")] },
      ],
    },
    {
      id: "riders",
      title: "Riders and warehouses",
      icon: "bx-cycling",
      entries: [
        { id: "riders-page", q: "What is on the Riders page?", a: [bullets("Your team, and who is on the road.", "Deliveries that need a look: failed ones, and ones delivered without a code.", "Warehouses and what each one holds.", "The rules and automatic assignment, which an administrator sets.")] },
        { id: "failed", q: "A rider could not deliver", a: [t("It shows under Deliveries that need a look, with the reason (no answer, wrong address, refused, something else). Call the customer, and decide with them: try again, or tell an administrator if it must be cancelled and refunded. The rider keeps the parcel until you call.")] },
      ],
    },
    {
      id: "stock",
      title: "Stock and warehouses",
      icon: "bx-box",
      entries: [
        { id: "inventory", q: "How do I change stock?", a: [steps("Open Inventory and find the product (search, or use the tabs: Needs attention, Out of stock, Running low).", "Tap Adjust stock.", "If the shop has several warehouses, choose which one at the top.", "Change the numbers, choose why (for example New stock arrived), and Save."), note("Every change is recorded with who made it and why.")] },
        { id: "where-stock", q: "Where is a product's stock?", a: [t("When there is more than one warehouse, each product shows small labels such as Kigali 12 · Musanze 3. The total is what customers see.")] },
        { id: "move", q: "I moved goods between warehouses", a: [t("In the product's Adjust stock sheet, open Move some to another warehouse, say how many, and tap Move it. The total does not change. Do this when you really carry the goods, so the numbers stay true.")] },
        { id: "waiting-items", q: "An order says Waiting for items", a: [t("A customer's order needs goods that are in another warehouse. The order is filled from one warehouse (the nearest one that can), and the missing items must come from another. You are told when it is paid."), steps("Open the order. The orange box lists what to move, how many, and from where.", "Carry the goods to the warehouse named in the box.", "Tap It has arrived next to each item."), t("Only then can a rider take the order. Until you do, riders do not see it, and it cannot be assigned.")] },
      ],
    },
    {
      id: "inbox",
      title: "Chats and notifications",
      icon: "bx-conversation",
      entries: [
        { id: "answering-chats", q: "How do I answer customers?", a: [t("Open Inbox. The chat that has waited longest is first. Open it and write. Use the saved replies button for common answers. Use Assign to me so nobody else answers the same chat, and tap Close when it is done (you can Reopen it). The tabs All, Needs reply, Mine and Closed help you find the right one."), note("Never ask a customer for a PIN or password.")] },
        { id: "notifications", q: "What are the notifications for?", a: [t("The bell tells you what needs attention: new orders, low stock, chats, deliveries that need a look, and items that must move for an order. You can search, filter, and mark them read.")] },
        { id: "analytics", q: "What can I see in Analytics?", a: [t("Counts, stock and support figures. Money figures are for administrators.")] },
      ],
    },
  ],
};

export const GUIDES = { customer: CUSTOMER_GUIDE, rider: RIDER_GUIDE, staff: STAFF_GUIDE } as const;

/** The plain words of one entry, for searching. */
export const textOf = (e: Entry): string =>
  [e.q, ...e.a.flatMap((b) => ("text" in b ? [b.text] : "note" in b ? [b.note] : "steps" in b ? b.steps : b.bullets))].join(" ").toLowerCase();

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
