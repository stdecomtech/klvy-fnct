import fetch from "node-fetch";

type Customer = {
  id: number;
  email: string;
  accepts_marketing: boolean;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  state: string;
  total_spent: string;
  last_order_id: number;
  note: null | string;
  verified_email: boolean;
  multipass_identifier: null | string;
  tax_exempt: boolean;
  tags: string;
  last_order_name: string;
  currency: string;
  phone: null | string;
  addresses: any[]; // Using any[] here because the inner structure of the address is not provided
  accepts_marketing_updated_at: string;
  marketing_opt_in_level: string;
  tax_exemptions: any[]; // Using any[] if the exact structure isn't known
  email_marketing_consent: {
    state: string;
    opt_in_level: string;
    consent_updated_at: string;
  };
  sms_marketing_consent: null | any; // Using any if the exact structure isn't known
  admin_graphql_api_id: string;
  default_address: {
    id: number;
    customer_id: number;
    first_name: string;
    last_name: string;
    company: string;
    address1: string;
    address2: string;
    city: string;
    province: null | string;
    country: string;
    zip: string;
    phone: string;
    name: string;
    province_code: null | string;
    country_code: string;
    country_name: string;
    default: boolean;
  };
};

type CustomerAPIObject = {
  customer: Customer;
};

async function getShopifyLTV(opts: {
  customerId: string;
  SHOPIFY_API_KEY: string;
  shopURL: string;
  orderId: string;
}) {
  const { SHOPIFY_API_KEY, customerId, shopURL, orderId } = opts;

  const url = `${shopURL}/admin/api/2023-07/customers/${customerId}.json`;

  const raw = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": SHOPIFY_API_KEY,
    },
  });
  const data: CustomerAPIObject = await raw.json();
  let shouldAddLastOrder = true; 
  if (`${data?.customer?.last_order_id}` == `${orderId}`) {
    shouldAddLastOrder = false
    // compare strings because we don't know if it wil be a string or number
  }
  return {
    result: parseFloat(data?.customer?.total_spent), // parseFloat because shopify send it as a string 
    shouldAddLastOrder,
  }; 
}

exports.handler = async function (event, context) {
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Successful preflight call." }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Invalid request body." }),
    };
  }

  const payload = JSON.parse(event.body);

  if (
    !payload.event_data ||
    !payload.event_data.email ||
    typeof payload.event_data.orderTotalPrice !== "number" ||
    !payload.event_data.shopName
  ) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message:
          "Vérifiez que vous avez bien entré toutes les données partout !",
      }),
    };
  }

  const shopName = payload.event_data.shopName;
  const shopURL = payload.event_data.shopURL;
  const shopifyCustomerId = payload.event_data.customerId;
  const orderId = payload.event_data.orderId;
  const ENV_VARIABLE_NAME_KLAVIYO = `KLAVIYO_KEY_${shopName}`;
  const ENV_VARIABLE_NAME_SHOPIFY = `SHOPIFY_KEY_${shopName}`;
  const KLAVIYO_API_KEY = process.env[ENV_VARIABLE_NAME_KLAVIYO];
  const SHOPIFY_API_KEY = process.env[ENV_VARIABLE_NAME_SHOPIFY];
  if (!KLAVIYO_API_KEY) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `La variable d'environnement ${ENV_VARIABLE_NAME_KLAVIYO} n'a pas été créée dans netlify ;) `,
      }),
    };
  }

  if (!SHOPIFY_API_KEY) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `La variable d'environnement ${SHOPIFY_API_KEY} n'a pas été créée dans netlify ;) `,
      }),
    };
  }

 const {result: LTVFromShopify, shouldAddLastOrder} = await getShopifyLTV({customerId: shopifyCustomerId, SHOPIFY_API_KEY, shopURL, orderId})

  const email = payload.event_data.email;
  const orderTotalAmount = payload.event_data.orderTotalPrice;

  // Check if Klaviyo profile exists for the given email
  let profileData;
  try {
    const profileResponse = await fetch(
      `https://a.klaviyo.com/api/profiles?filter=equals(email,"${email}")`,
      {
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          revision: "2023-09-15",
        },
      }
    );
    profileData = await profileResponse.json();
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Error fetching profile from Klaviyo." }),
    };
  }

  let profileId;
  if (profileData && profileData.data && profileData.data.length > 0) {
    profileId = profileData.data[0].id;
    const updatedLTV = shouldAddLastOrder ? LTVFromShopify + orderTotalAmount : LTVFromShopify;

    // Update the custom LTV property
    try {
      await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          revision: "2023-09-15",
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        },
        body: JSON.stringify({
          data: {
            type: "profile",
            id: profileId,
            attributes: {
              properties: {
                custom_LTV: updatedLTV,
              },
            },
          },
        }),
      });
    } catch (error) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: "Error updating LTV property in Klaviyo.",
        }),
      };
    }
  } else {
    // Create a new profile with the custom_LTV property set to orderTotalAmount
    try {
      const createProfileResponse = await fetch(
        `https://a.klaviyo.com/api/profiles/`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            revision: "2023-09-15",
            Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          },
          body: JSON.stringify({
            data: {
              type: "profile",
              attributes: {
                email: email,
                properties: {
                  custom_LTV: orderTotalAmount,
                },
              },
            },
          }),
        }
      );
      const newProfileData = await createProfileResponse.json();
      if (!newProfileData || !newProfileData.data || !newProfileData.data.id) {
        return {
          statusCode: 500,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            message: "Unexpected response from Klaviyo when creating profile.",
          }),
        };
      }
    } catch (error) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: "Error creating new profile in Klaviyo.",
        }),
      };
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message: "All good" }),
  };
};
