import { createFileRoute, Link } from "@tanstack/react-router";
import { List, PolicyPage, Section } from "@/components/shop/PolicyPage";
import { seoMeta } from "@/lib/seo";

export const Route = createFileRoute("/returns")({
  head: () =>
    seoMeta({
      title: "Returns and refunds — MOA Mart",
      description: "If an item arrives wrong, damaged or faulty, tell MOA Mart within 7 days. We replace it or refund you to your mobile money number.",
      path: "/returns",
    }),
  component: Returns,
});

function Returns() {
  return (
    <PolicyPage title="Returns and refunds" intro="If something is wrong with your order, we will make it right.">
      <Section title="When we help">
        <p>Contact us within 7 days of delivery if an item:</p>
        <List items={["is not what you ordered,", "arrives damaged, or", "does not work (it is faulty)."]} />
        <p>
          Returns because you changed your mind are not part of this policy at the moment. If that changes, we will update this page.
        </p>
      </Section>

      <Section title="How to ask">
        <p>
          <Link to="/contact" className="text-primary hover:underline">
            Contact us
          </Link>{" "}
          by chat, email or phone. Please give us your order number and send one or more photos that show the problem.
        </p>
      </Section>

      <Section title="What we do">
        <p>
          We check what you send us, then we agree with you on a replacement or a refund of the amount you paid for that item.
        </p>
      </Section>

      <Section title="How refunds are paid">
        <p>
          Refunds go back to the same mobile money number you paid with (MTN MoMo or Airtel Money). We start the refund as soon as it is approved.
          How quickly the money appears depends on your mobile money provider.
        </p>
      </Section>

      <Section title="Cancelling an order">
        <List
          items={[
            <>
              <strong className="font-medium text-foreground">Not paid yet.</strong> You can cancel it yourself in{" "}
              <Link to="/orders" className="text-primary hover:underline">
                My orders
              </Link>
              . The items are released straight away.
            </>,
            <>
              <strong className="font-medium text-foreground">Paid, and not sent yet.</strong> Contact us. We can cancel the order and refund the
              amount you paid.
            </>,
            <>
              <strong className="font-medium text-foreground">Already on the way or delivered.</strong> See “When we help” above.
            </>,
          ]}
        />
      </Section>

      <Section title="Your rights">
        <p>This policy does not take away any right you have under the law.</p>
      </Section>
    </PolicyPage>
  );
}
