const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const app = express();
const port = 3000;

dotenv.config();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b5csq0d.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("microTaskingDB"); // use your DB name
    usersCollection = db.collection("users");

    app.post("/users", async (req, res) => {
      try {
        const { uid, name, email, photoURL, role } = req.body;

        if (!email || !role) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(400).json({ message: "User already exists" });
        }

        // Assign coins based on role
        const coin = role === "Buyer" ? 50 : 10;

        const newUser = {
          uid,
          name,
          email,
          photoURL,
          role,
          coin,
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        return res
          .status(201)
          .json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Internal server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
