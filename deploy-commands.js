require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];

function collectCommands(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCommands(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const mod = require(fullPath);
      if (mod.data) commands.push(mod.data.toJSON());
      for (const key of Object.keys(mod)) {
        if (mod[key]?.data) commands.push(mod[key].data.toJSON());
      }
    }
  }
}

collectCommands(path.join(__dirname, 'commands'));

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log(`🔄 ${commands.length}개 슬래시 커맨드 등록 중...`);
  const data = await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log(`✅ ${data.length}개 커맨드 등록 완료!`);
  data.forEach(c => console.log(`  /${c.name}`));
})().catch(console.error);
