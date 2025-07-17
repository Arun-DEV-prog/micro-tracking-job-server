const express = require("express");
const cors = require("cors");

const dotenv = require("dotenv");
const app = express();
const port = 3000;

dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
app.use(
  cors({
    origin: "http://localhost:5173", // or wherever your frontend runs
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    await client.connect();

    const db = client.db("microTaskingDB");
    const usersCollection = db.collection("users");
    const tasksCollection = db.collection("task");
    const paymentsCollection = db.collection("payment");
    const submissionCollection = db.collection("submission");
    const withdrawalsCollection = db.collection("withdrawals");

    // Create User
    app.post("/users", async (req, res) => {
      try {
        const { uid, name, email, photoURL, role } = req.body;

        if (!email || !role) {
          return res.status(400).json({ message: "Missing required fields" });
        }

        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.status(400).json({ message: "User already exists" });
        }

        const coin = role === "Buyer" ? 50 : 10;

        const newUser = {
          uid,
          name,
          email,
          photoURL,
          role,
          coins: coin,
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

    // Get user by email
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send(user);
    });

    // Deduct coins from buyer
    app.patch("/users/:email/deduct", async (req, res) => {
      const email = req.params.email;
      const { amount } = req.body;

      const result = await usersCollection.updateOne(
        { email },
        { $inc: { coin: -amount } }
      );

      res.send(result);
    });

    // Add new task
    app.post("/tasks", async (req, res) => {
      const task = req.body;
      task.status = "active";
      task.createdAt = new Date();

      const result = await tasksCollection.insertOne(task);
      res.send(result);
    });

    // Get tasks by buyer email
    app.get("/tasks/buyer/:email", async (req, res) => {
      const email = req.params.email;
      const tasks = await tasksCollection
        .find({ buyer_email: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(tasks);
    });

    // Delete task by ID
    app.delete("/tasks/:id", async (req, res) => {
      const taskId = req.params.id;
      const task = await tasksCollection.findOne({ _id: new ObjectId(taskId) });

      if (!task) return res.status(404).send("Task not found");

      const totalRefund = task.required_workers * task.payable_amount;

      // Delete task
      await tasksCollection.deleteOne({ _id: new ObjectId(taskId) });

      // Refill coins only if task not completed (add your own completed logic if needed)
      await usersCollection.updateOne(
        { email: task.buyer_email },
        { $inc: { coins: totalRefund } }
      );

      res.send({ message: "Task deleted and coins refunded if uncompleted" });
    });

    // Update task fields
    app.patch("/tasks/:id", async (req, res) => {
      const { id } = req.params;
      const { task_title, task_detail, submission_info } = req.body;

      const result = await tasksCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { task_title, task_detail, submission_info } }
      );

      res.send(result);
    });

    // stripe
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = price * 100; // Convert to cents

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.post("/payments", async (req, res) => {
      const { email, coins, price, transactionId } = req.body;

      const result = await paymentsCollection.insertOne({
        email,
        coins,
        price,
        transactionId,
        date: new Date(),
      });

      await usersCollection.updateOne({ email }, { $inc: { coin: coins } });

      res.send(result);
    });

    // payments history
    // Get payment history by user email
    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const payments = await paymentsCollection
          .find({ email })
          .sort({ date: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        res.status(500).send({ message: "Failed to get payment history" });
      }
    });

    // buyer state home page
    app.get("/buyer/stats", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      try {
        const tasks = await tasksCollection
          .find({ buyer_email: email })
          .toArray();

        const taskCount = tasks.length;

        // Count of total required_workers left (pending workers)
        const pendingWorkerCount = tasks.reduce(
          (sum, task) => sum + (task.required_workers || 0),
          0
        );

        // Count total submissions for this buyer's tasks that are approved
        const taskIds = tasks.map((task) => task._id.toString());

        const approvedSubmissions = await submissionCollection
          .find({
            task_id: { $in: taskIds },
            status: "approved",
          })
          .toArray();

        const totalPaid = approvedSubmissions.reduce(
          (sum, sub) => sum + (sub.payable_amount || 0),
          0
        );

        res.json({ taskCount, pendingWorkerCount, totalPaid });
      } catch (err) {
        console.error("Error in /buyer/stats", err);
        res.status(500).json({ error: "Server error" });
      }
    });

    // getting submission for review
    app.get("/buyer/pending-submissions", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ error: "Buyer email is required" });
      }

      try {
        // Step 1: Get all task IDs for this buyer
        const tasks = await tasksCollection
          .find({ buyer_email: email })
          .toArray();
        const taskIds = tasks.map((task) => task._id.toString());

        // Step 2: Find pending submissions linked to those tasks
        const pendingSubmissions = await submissionCollection
          .find({
            task_id: { $in: taskIds },
            status: "pending",
          })
          .toArray();

        res.send(pendingSubmissions);
      } catch (err) {
        console.error("Error fetching pending submissions:", err);
        res.status(500).send({ error: "Server error" });
      }
    });

    // approve submission
    app.patch("/submissions/:id/approve", async (req, res) => {
      const id = req.params.id;

      const submission = await submissionCollection.findOne({
        _id: new ObjectId(id),
      });

      const updateSubmission = await submissionCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved" } }
      );

      // Update worker coin
      await usersCollection.updateOne(
        { email: submission.worker_email },
        { $inc: { coin: submission.payable_amount } }
      );

      res.send(updateSubmission);
    });

    // reject submission
    app.patch("/submissions/:id/reject", async (req, res) => {
      const id = req.params.id;

      const submission = await submissionCollection.findOne({
        _id: new ObjectId(id),
      });

      const updateSubmission = await submissionCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "rejected" } }
      );

      await tasksCollection.updateOne(
        { _id: new ObjectId(submission.task_id) },
        { $inc: { required_workers: 1 } }
      );

      res.send(updateSubmission);
    });

    // worker dashboard get all task
    app.get("/tasks/available", async (req, res) => {
      const tasks = await tasksCollection
        .find({ required_workers: { $gt: 0 } })
        .toArray();
      res.send(tasks);
    });

    // TaskList
    app.get("/tasks/:id", async (req, res) => {
      const { id } = req.params;
      const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
      res.send(task);
    });

    // worl submissions
    app.post("/submissions", async (req, res) => {
      const submission = req.body;
      const result = await submissionCollection.insertOne(submission);

      // Optional: Decrease required_workers by 1
      await tasksCollection.updateOne(
        { _id: new ObjectId(submission.task_id) },
        { $inc: { required_workers: -1 } }
      );

      res.send(result);
    });
    //  create get submission routes
    app.get("/submissions", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.send([]);

      const submissions = await submissionCollection
        .find({ worker_email: email })
        .toArray();

      res.send(submissions);
    });
    // withdraw
    // Express POST route
    // Express POST route
    app.post("/withdrawals", async (req, res) => {
      const {
        worker_email,
        worker_name,
        withdrawal_coin,
        withdrawal_amount,
        payment_system,
        account_number,
        withdraw_date,
        status,
      } = req.body;

      if (
        !worker_email ||
        !withdrawal_coin ||
        !withdrawal_amount ||
        !payment_system
      ) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const result = await withdrawalsCollection.insertOne({
        worker_email,
        worker_name,
        withdrawal_coin,
        withdrawal_amount,
        payment_system,
        account_number,
        withdraw_date,
        status,
      });

      if (result.insertedId) {
        // Update user coin after withdrawal
        await usersCollection.updateOne(
          { email: worker_email },
          { $inc: { coin: -withdrawal_coin } }
        );
        res.send({ success: true });
      } else {
        res.status(500).send({ message: "Insertion failed" });
      }
    });

    // Ping success
    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB Connected ✅");
  } finally {
    // Don't close client in development
    // await client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
