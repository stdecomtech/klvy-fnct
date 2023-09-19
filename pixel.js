const shopName = "EXAMPLE";

async function standardEcomTracking(data) {
  const url =
    "https://standard-ecom.netlify.app/.netlify/functions/sync_klaviyo_ltv";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error("API request failed");
    }
  } catch (error) {
    console.error(error);
  }
}

analytics.subscribe("checkout_completed", (event) => {
  const email = event.data.checkout.email;
  if (!email) {
    return; // no email, no tracking :(
  }
  const orderTotalPrice = event.data.checkout.totalPrice.amount;

  const data = {
    event_type: "checkout_completed",
    event_data: {
      email,
      orderTotalPrice,
      shopName,
    },
  };

  standardEcomTracking(data);
});
