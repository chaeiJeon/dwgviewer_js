const express = require("express");
const cors = require("cors");
const multer = require("multer");
const forgeSDK = require("forge-apis");

const app = express();
const port = 8080;
const corsOptions = {
  origin: "*",
  credential: true,
};
app.use(express.json());
app.use(cors());
app.listen(port);

const upload = multer({ dest: "uploads/" });

const clientId = "uAtyKYfmyDzfUElly2Brd5yMejDAOio1";
const clientSecret = "OnWj2Q32VoeHwFmv";
let token;

let oAuth2TwoLegged = new forgeSDK.AuthClientTwoLegged(clientId, clientSecret, [
  "data:read",
  "data:write",
  "bucket:read",
  "bucket:create",
]);
start();
async function start() {
  token = await oAuth2TwoLegged.authenticate().catch((err) => {
    throw new Error(`Error during authentication: ${err.message}`);
  });
}
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

app.get("/getInfo", (req, res) => {
  res.send({
    token,
  });
});
app.post("/upload", upload.single("dwg"), async (req, res) => {
  try {
    const bucketApi = new forgeSDK.BucketsApi();
    const bucketKey = "bucketkey" + Date.now().toString().substring(7);

    const policyKey = "transient"; // transient, temporary, persistent
    console.log(bucketKey);
    // Create Bucket
    const createBucketPayload = new forgeSDK.PostBucketsPayload();
    createBucketPayload.bucketKey = bucketKey;
    createBucketPayload.policyKey = policyKey;
    await bucketApi
      .createBucket(createBucketPayload, {}, oAuth2TwoLegged, token)
      .catch((err) => {
        throw new Error(`Error during bucket creation:s ${err.message}`);
      });
    // Upload Object to Bucket
    const filePath = req.file.path;
    const fs = require("fs");
    fs.readFile(filePath, async (err, data) => {
      if (err) throw err;

      const objectApi = new forgeSDK.ObjectsApi();
      const uploadRes = await objectApi
        .uploadObject(
          bucketKey,
          req.file.originalname,
          data.length,
          data,
          {},
          oAuth2TwoLegged,
          token
        )
        .catch((err) => {
          throw new Error(`Error during object upload: ${err.message}`);
        });
      // Convert DWG to SVF
      const derivatives = new forgeSDK.DerivativesApi();
      const urn = Buffer.from(uploadRes.body.objectId, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const job = {
        input: {
          urn,
        },
        output: {
          formats: [
            {
              type: "svf",
              views: ["3d"],
            },
          ],
        },
      };
      const response = await derivatives.translate(
        job,
        {},
        oAuth2TwoLegged,
        token
      );

      if (response.body.result === "success") {
        // The job was submitted successfully and is now being processed
        let manifest;
        do {
          // wait for a while before checking the status again
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // Get the manifest (status of the translation job)
          manifest = await derivatives.getManifest(
            urn,
            {},
            oAuth2TwoLegged,
            token
          );
        } while (manifest.body.status !== "success");

        // At this point the translation job is done and the file can be viewed
        console.log(`File ${urn} translated successfully.`);
        res.send({
          data: {
            token,
            urn,
          },
        });
      } else {
        throw new Error(`Error during translation: ${response.body.result}`);
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error uploading file.");
  }
});
