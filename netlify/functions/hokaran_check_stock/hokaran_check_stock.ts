import { Handler } from "@netlify/functions";
import * as https from "https";
import { Type } from "typescript";

export const handler: Handler = async (event, context) => {

  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': '*',
  };
  
  if (event.httpMethod === 'OPTIONS') {
    console.log('OPTIONS ', { CORS_HEADERS });
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Successful preflight call.' }),
    };
  }
  
  const SHOPIFY_ACCESS_TOKEN = process.env.HOKARAN_SHOPIFY_ACCESS_TOKEN;
  const LOCATION_ID = "gid://shopify/Location/5907972207";
//
  const shopifyGraphEndpoint =
    "https://hokaran.myshopify.com/admin/api/2023-04/graphql.json";
  if (!event.body) {
    return {
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      statusCode: 400,
      body: JSON.stringify({ err: "no body :( " }),
    };
  }
  const body = JSON.parse(event.body);

  const queryBody = `
  {
    productVariant(id: "gid://shopify/ProductVariant/${body.variant_id}") {
      id
      title
      inventoryItem {
        id
        inventoryLevels(first: 10) {
          edges {
            node {
              quantities(names:"available") {
                name
                quantity
              }
              location {
                id
                name
              }
            }
          }
        }
      }
    }
  }
  `;

  const shopifyData: any = await makeRequest(
    shopifyGraphEndpoint,
    "POST",
    {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN, // Replace with your actual access token
    },
    JSON.stringify({ query: queryBody })
  );

  // Handle the GraphQL response
  if (!shopifyData || !shopifyData.data || !shopifyData.data.productVariant) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ err: "Invalid response from Shopify", body, shopifyData}),
    };
  }

  const variant = shopifyData.data.productVariant;
  const inventoryItem = variant.inventoryItem;

  if (
    !inventoryItem ||
    !inventoryItem.inventoryLevels ||
    !inventoryItem.inventoryLevels.edges
  ) {
    return {
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      statusCode: 500,
      body: JSON.stringify({ err: "No inventory data available" }),
    };
  }

  let stockAvailable = null;
try {


  for (let edge of inventoryItem.inventoryLevels.edges) {
    const node = edge.node;
    if (node.location && node.location.id === LOCATION_ID) {
      stockAvailable = node?.quantities?.find(
        (q) => q.name === "available"
      )?.quantity;
      break;
    }
  }

  if (stockAvailable === null) {
    return {
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      statusCode: 404,
      body: JSON.stringify({
        err: "No stock data available for the specified location",
      }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({ stock: stockAvailable, body, shopifyData }),
  };
  } catch (err) {
    return {
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
    statusCode: 500,
    body: JSON.stringify({ err,  body, shopifyData  }),

    }
  }
};

function makeRequest(url, method, headers = {}, body?: any) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: headers,
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        resolve(JSON.parse(data));
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}
