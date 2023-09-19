import fetch from "node-fetch";

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
      body: JSON.stringify({ message: "Missing or invalid data in payload." }),
    };
  }

  const shopName = payload.event_data.shopName;
  const ENV_VARIABLE_NAME = `KLAVIYO_KEY_${shopName}`;
  const KLAVIYO_API_KEY = process.env[ENV_VARIABLE_NAME];
  if (!KLAVIYO_API_KEY) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: `Missing environment variable ${ENV_VARIABLE_NAME}`,
      }),
    };
  }

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
    const currentLTV =
      profileData.data[0].attributes.properties.custom_LTV || 0;
    const updatedLTV = currentLTV + orderTotalAmount;

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
