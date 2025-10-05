const API_URL = "https://your-render-app.onrender.com"; // ← RenderのURLに変更
const socket = io(API_URL);

socket.on("connect", () => console.log("🔌 connected to server"));
socket.on("new_bounty", (bounty) => {
  console.log("🟢 新しい依頼:", bounty);
  appendBounty(bounty);
});

async function loadBounties() {
  const res = await fetch(`${API_URL}/api/bounties`);
  const bounties = await res.json();
  const list = document.getElementById("bountyList");
  list.innerHTML = "";
  bounties.forEach((b) => appendBounty(b));
}

function appendBounty(b) {
  const list = document.getElementById("bountyList");
  const li = document.createElement("li");
  li.innerHTML = `<span class="green">#${b.id}</span> ${b.title} (${b.reward}pt)
    <span class="white">${b.description}</span>`;
  li.onclick = () => showDetail(b);
  list.prepend(li);
}

async function createBounty() {
  const title = document.getElementById("title").value;
  const description = document.getElementById("description").value;
  const reward = parseInt(document.getElementById("reward").value);
  const image_url = document.getElementById("image_url").value;
  const deadline = document.getElementById("deadline").value;

  if (!title || !reward || !deadline) return alert("入力が足りません。");

  await fetch(`${API_URL}/api/bounties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description, reward, image_url, deadline }),
  });
}

function showDetail(b) {
  const box = document.getElementById("detailBox");
  box.style.display = "block";
  box.innerHTML = `
    <h3 class="green">${b.title}</h3>
    <p class="white">${b.description}</p>
    ${b.image_url ? `<img src="${b.image_url}" style="max-width:300px;">` : ""}
    <p class="green">報酬: ${b.reward}pt</p>
    <p id="countdown"></p>
  `;
  startCountdown(new Date(b.deadline));
}

function startCountdown(end) {
  const el = document.getElementById("countdown");
  const timer = setInterval(() => {
    const now = new Date();
    let diff = Math.floor((end - now) / 1000);
    if (diff < 0) {
      clearInterval(timer);
      el.textContent = "締切終了";
      return;
    }
    const h = String(Math.floor(diff / 3600)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, "0");
    const s = String(diff % 60).padStart(2, "0");
    el.textContent = `残り時間: ${h}:${m}:${s}`;
  }, 1000);
}

document.getElementById("btnCreate").onclick = createBounty;
loadBounties();
