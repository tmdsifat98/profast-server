const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const e = require("express");
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
var admin = require("firebase-admin");
var serviceAccount = require("./firebase-sdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@alpha10.qadkib3.mongodb.net/?retryWrites=true&w=majority&appName=Alpha10`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("profast");
    const parcelCollection = db.collection("parcels");
    const userCollection = db.collection("users");
    const riderCollection = db.collection("riders");

    // Verify Firebase ID Token Middleware
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = authHeader.split("Bearer ")[1];

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        console.error("Firebase token verification error:", error);
        res.status(401).send({ message: "Unauthorized access" });
      }
    };
    //verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email: email });
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    //set user on database with role
    app.post("/users", async (req, res) => {
      const { email, name } = req.body;
      const updatedUser = {
        email,
        name,
        role: "user",
        createdAt: new Date().toISOString(),
        lastLogIn: new Date().toISOString(),
      };
      const isExist = await userCollection.findOne({ email: email });
      if (!!isExist) {
        const result = await userCollection.updateOne(
          { email: email },
          { $set: { lastLogIn: new Date().toISOString() } }
        );
        res.send(result);
        return;
      }
      const result = await userCollection.insertOne(updatedUser);
      res.send(result);
    });

    //make admin finder
    app.get("/users/search",verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const query = {};
      query.email = { $regex: email, $options: "i" };
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    //make admin
    app.patch(
      "/users/admin/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "admin" } }
        );
        res.send(result);
      }
    );

    //Remove admin
    app.patch(
      "/users/admin/:id/remove",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: "user" } }
        );
        res.send(result);
      }
    );

    //get parcels
    app.post("/parcels", verifyFirebaseToken, async (req, res) => {
      const newParcel = req.body;
      const result = await parcelCollection.insertOne(newParcel);
      res.send(result);
    });

    //rider application api
    app.post("/riders", async (req, res) => {
      const riderData = req.body;
      const result = await riderCollection.insertOne(riderData);
      res.send(result);
    });

    //get rider applications
    app.get(
      "/api/riders",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.query.status;
        const query = status ? { status } : {};
        const result = await riderCollection.find(query).toArray();
        res.send(result);
      }
    );

    //accept rider
    app.post("/api/riders/accept", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;

      try {
        // Rider collection - status update
        const riderUpdateResult = await riderCollection.updateOne(
          { email: email },
          { $set: { status: "approved" } }
        );

        // User collection - role update
        const userUpdateResult = await userCollection.updateOne(
          { email: email },
          { $set: { role: "rider" } }
        );

        res.send({
          riderUpdate: riderUpdateResult,
          userUpdate: userUpdateResult,
        });
      } catch (error) {
        console.error("Error approving rider:", error);
        res.status(500).json({ message: "Internal server error." });
      }
    });

    //reject rider
    app.post("/api/riders/reject", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;

      try {
        const result = await riderCollection.updateOne(
          { email: email, status: "pending" },
          {
            $unset: { status: "" },
          }
        );

        res.send(result);
      } catch (error) {
        console.error("Error rejecting rider:", error);
        res.status(500).json({ message: "Internal server error." });
      }
    });

    //all riders
    app.get("/riders", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const result = await riderCollection
        .find({ status: "approved" })
        .toArray();
      res.send(result);
    });

    //delete rider
    app.post("/riders/delete", verifyFirebaseToken, async (req, res) => {
      const { email } = req.body;
      console.log(email);
      const roleUpdateResult = await userCollection.updateOne(
        { email: email },
        { $set: { role: "user" } }
      );
      const deleteRiderResult = await riderCollection.deleteOne({
        email: email,
      });
      res.send({ roleUpdateResult, deleteRiderResult });
    });

    //get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).json({ role: "unknown" });
      }
      res.send({ role: user.role || "user" });
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Profast community");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
