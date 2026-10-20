import { createFileRoute, Link } from "@tanstack/react-router";
import { List, PolicyPage, Section } from "@/components/shop/PolicyPage";
import { seoMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/delivery")({
  head: () =>
    seoMeta({
      title: "Delivery in Kigali — MOA Mart",
      description: "MOA Mart delivers in Kigali. Pay with MTN MoMo or Airtel Money, then follow your order from placed to delivered.",
      path: "/delivery",
    }),
  component: Delivery,
});

function Delivery() {
  return (
    <PolicyPage title="Delivery" intro={`We deliver to your door in ${SITE.address.city}.`}>
      <Section title="Where we deliver">
        <p>
          For now we deliver only in {SITE.address.city}, {SITE.address.country}. When you check out, you tell us your delivery location.
        </p>
      </Section>

      <Section title="Delivery cost and time">
        <p>
          The delivery cost and the expected time are confirmed after you place your order. If we need directions, we call the phone number you
          gave at checkout.
        </p>
      </Section>

      <Section title="How your order moves">
        <List
          items={[
            <>
              <strong className="font-medium text-foreground">Place your order and pay.</strong> You pay with MTN MoMo or Airtel Money. You approve
              the payment on your phone. We keep your items for you for 15 minutes while you pay. If the payment is not made in that time, the
              order expires and the items are released.
            </>,
            <>
              <strong className="font-medium text-foreground">Confirmed.</strong> As soon as your payment arrives, your order is confirmed
              automatically.
            </>,
            <>
              <strong className="font-medium text-foreground">On the way.</strong> We prepare your order and send it out for delivery.
            </>,
            <>
              <strong className="font-medium text-foreground">Delivered.</strong> You receive your order.
            </>,
          ]}
        />
        <p>
          You can follow each step in{" "}
          <Link to="/orders" className="text-primary hover:underline">
            My orders
          </Link>
          , and we send you a notification when something changes.
        </p>
      </Section>

      <Section title="When your order arrives">
        <p>
          Please check the items when you receive them. If something is wrong, see{" "}
          <Link to="/returns" className="text-primary hover:underline">
            Returns and refunds
          </Link>
          .
        </p>
      </Section>

      <Section title="Questions about delivery">
        <p>
          <Link to="/contact" className="text-primary hover:underline">
            Contact us
          </Link>{" "}
          with your order number and we will help.
        </p>
      </Section>
    </PolicyPage>
  );
}
