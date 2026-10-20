import { createFileRoute, Link } from "@tanstack/react-router";
import { List, PolicyPage, Section } from "@/components/shop/PolicyPage";
import { seoMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/terms")({
  head: () =>
    seoMeta({
      title: "Terms of service — MOA Mart",
      description: "The terms for using MOA Mart and placing orders: prices, payment by mobile money, delivery in Kigali, cancellations and returns.",
      path: "/terms",
    }),
  component: Terms,
});

function Terms() {
  return (
    <PolicyPage
      title="Terms of service"
      intro="These terms apply when you use MOA Mart or place an order. By using the shop you agree to them."
    >
      <Section title="Who we are">
        <p>
          MOA Mart is operated by {SITE.legalName}, {SITE.address.street}, {SITE.address.city}, {SITE.address.country}. You can reach us on the{" "}
          <Link to="/contact" className="text-primary hover:underline">
            contact page
          </Link>
          .
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You can browse and order as a guest or with an account. Please give us correct information, and keep your password safe. You are
          responsible for what happens under your account.
        </p>
      </Section>

      <Section title="Products and prices">
        <List
          items={[
            "Prices are in Rwandan francs (RWF).",
            "Photos and descriptions are there to help you choose. Colours on your screen may differ a little from the product.",
            "Items are limited by stock. We may correct a price or a description if it contains an obvious mistake, and we will tell you before you pay.",
          ]}
        />
      </Section>

      <Section title="Orders and payment">
        <List
          items={[
            "You pay with MTN MoMo or Airtel Money. You approve the payment on your phone.",
            "When you place an order we keep the items for you for 15 minutes. If the payment is not made in that time, the order expires.",
            "Your order is confirmed when your payment arrives.",
            "We may cancel an order, for example if an item is not available or a payment problem cannot be solved. If you have paid, we refund the amount you paid.",
          ]}
        />
      </Section>

      <Section title="Delivery">
        <p>
          We deliver in {SITE.address.city}. The delivery cost and time are confirmed after you order. Read more on the{" "}
          <Link to="/delivery" className="text-primary hover:underline">
            delivery page
          </Link>
          .
        </p>
      </Section>

      <Section title="Returns and refunds">
        <p>
          See{" "}
          <Link to="/returns" className="text-primary hover:underline">
            Returns and refunds
          </Link>{" "}
          for what to do when an item is wrong, damaged or faulty, and how refunds are paid.
        </p>
      </Section>

      <Section title="Using the site">
        <p>
          Please use the shop honestly. Do not try to disturb or break the site, to see other people&apos;s data, or to place orders you do not
          intend to pay for.
        </p>
      </Section>

      <Section title="Our responsibility">
        <p>
          We take care to sell what we describe and to deliver it. We are not responsible for losses we could not reasonably foresee, or for delays
          caused by things outside our control. Nothing in these terms limits responsibility that the law does not allow us to limit.
        </p>
      </Section>

      <Section title="Your data">
        <p>
          How we handle your personal data is explained in our{" "}
          <Link to="/privacy-policy" className="text-primary hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </Section>

      <Section title="Changes and law">
        <p>
          We may update these terms. The date at the top shows when they last changed. These terms are governed by the law of Rwanda. For any
          question, write to{" "}
          <a href={`mailto:${SITE.email}`} className="text-primary hover:underline">
            {SITE.email}
          </a>
          .
        </p>
      </Section>
    </PolicyPage>
  );
}
