## Update docker image

To update:
```bash
docker build --network=host -t ursa-major-agent .
docker tag ursa-major-agent ziminas1990/ursa-major-agent:latest
docker push ziminas1990/ursa-major-agent:latest
```

## Prepare the server (ubuntu 24.04)
If failed to login by copy-paste password, try this:
```bash
sshpass -p "..." ssh root@185.170.213.27
```

Run the following commands to install docker:
```bash
apt update
apt install -y ca-certificates curl gnupg
# Add GPG key:
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
# Add repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
# Install docker:
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```


## Run docker image on server

To run:
```bash
mkdir -p config
mkdir -p logs
touch ./config/botcfg.json
touch ./config/runtime.json
touch ./config/google_cloud_key.json
touch ./config/tgbot_token
touch ./config/openai_api_key
# Update local image (optional)
docker pull ziminas1990/ursa-major-agent:latest
# Run the bot
docker run -ti --network=host \
       -v $(pwd)/config:/mnt/config \
       -v $(pwd)/logs:/mnt/logs \
       -d --name ursa-major-agent --restart unless-stopped \
       ziminas1990/ursa-major-agent:latest
```

To restart (without update):
```bash
docker kill ursa-major-agent
docker rm ursa-major-agent
docker run -ti --network=host \
       -v $(pwd)/config:/mnt/config \
       -v $(pwd)/logs:/mnt/logs \
       -d --name ursa-major-agent --restart unless-stopped \
       ziminas1990/ursa-major-agent:latest
```

For local run:
```bash
docker run -ti --rm --network=host -v $(pwd)/config:/mnt/config -v $(pwd)/logs:/mnt/logs --name ursa-major-agent ursa-major-agent:latest
```

## Things to be done:
* ignore all messages, received during the startup
* notifications about new applications
* notifications about new feedback
* use webpack to pack bot into a single js-file and publish docker image with this single file
* BUG: adding to memberships table
* configure logs rotation
* remove "chorister" role, because everyone who is not a guest is chorister
* TelegramCallbacks: add lifetime for callbacks. Once lifetime is out, callback should be removed

## Useful

Regex to find all imports with no ".js" specified:
```regex
import.*from\s+["']@([^"']*?)(?<!\.js)["']
```