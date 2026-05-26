#  Complete Project Guide
## Deploying Node.js on AWS Free Tier with Docker & Kubernetes

---

---

## PHASE 1 — Test the App Locally

```bash
# 1. Install dependencies
cd cloud-dashboard
npm install

# 2. Run locally
npm start

# 3. Open browser → http://localhost:3000
# Also test: http://localhost:3000/health
```

---

## PHASE 2 — Build Docker Image Locally

```bash
# Build the image
docker build -t cloud-dashboard:latest .

# Test the container locally
docker run -p 3000:3000 cloud-dashboard:latest

# Open browser → http://localhost:3000
# Stop with Ctrl+C

# Check the image size
docker images cloud-dashboard
```

---

## PHASE 3 — Push Image to Amazon ECR

### Step 3.1 — Create ECR Repository (do this once)
```bash
# Configure AWS CLI (run on your laptop)
aws configure
# Enter: Access Key ID, Secret Key, Region (us-east-1), output format (json)

# Create ECR repository
aws ecr create-repository \
  --repository-name cloud-dashboard \
  --region us-east-1

# Note the repositoryUri from the output — looks like:
# 123456789012.dkr.ecr.us-east-1.amazonaws.com/cloud-dashboard
```

### Step 3.2 — Login to ECR
```bash
# Replace 123456789012 and us-east-1 with your values
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS \
  --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

### Step 3.3 — Tag and Push Image
```bash
# Set your ECR URI (replace with your account ID)
ECR_URI="123456789012.dkr.ecr.us-east-1.amazonaws.com/cloud-dashboard"

# Tag image
docker tag cloud-dashboard:latest $ECR_URI:latest

# Push to ECR
docker push $ECR_URI:latest

# Verify in AWS Console → ECR → cloud-dashboard repository
```

---

## PHASE 4 — Launch EC2 Instance (Free Tier)

### Via AWS Console:
1. Go to **EC2 → Launch Instance**
2. Name: `cloud-k8s-server`
3. AMI: **Ubuntu Server 22.04 LTS** (Free Tier eligible)
4. Instance type: **t2.micro** (Free Tier — 1 vCPU, 1GB RAM)
5. Key pair: Create new → `cloud-project-key` → Download `.pem` file
6. Security Group — Add Inbound Rules:
   - SSH: Port 22 (Your IP)
   - HTTP: Port 80 (Anywhere)
   - Custom TCP: Port **30080** (Anywhere) ← NodePort for our app
7. Storage: 8 GB gp2 (Free Tier)
8. Click **Launch Instance**

### Get EC2 Public IP:
```
EC2 Console → Instances → your instance → Public IPv4 address
Example: 54.123.45.67
```

---

## PHASE 5 — Connect to EC2 & Install Docker + Minikube

### Connect via SSH:
```bash
# Fix key permissions (on your laptop)
chmod 400 cloud-project-key.pem

# SSH into EC2
ssh -i cloud-project-key.pem ubuntu@<YOUR-EC2-PUBLIC-IP>
```

### Install Docker:
```bash
# Update packages
sudo apt-get update -y

# Install Docker
sudo apt-get install -y docker.io

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add ubuntu user to docker group (so we don't need sudo)
sudo usermod -aG docker ubuntu

# Apply group change (re-login or run:)
newgrp docker

# Verify
docker --version
```

### Install kubectl:
```bash
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/
kubectl version --client
```

### Install Minikube:
```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

# Start Minikube with Docker driver
minikube start --driver=docker

# Verify
minikube status
kubectl get nodes
```

---

## PHASE 6 — Authenticate EC2 to ECR and Pull Image

### Install AWS CLI on EC2:
```bash
sudo apt-get install -y awscli
```

### Option A — Attach IAM Role to EC2 (Recommended):
1. AWS Console → IAM → Roles → Create Role
2. Trusted entity: EC2
3. Attach policy: `AmazonEC2ContainerRegistryReadOnly`
4. Name it: `EC2-ECR-ReadOnly`
5. EC2 Console → your instance → Actions → Security → Modify IAM Role → Attach `EC2-ECR-ReadOnly`

### Option B — Configure AWS credentials manually:
```bash
aws configure
# Enter your Access Key, Secret Key, Region
```

### Authenticate Docker to ECR:
```bash
# Replace ACCOUNT_ID and REGION
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS \
  --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com
```

### Load Image into Minikube:
```bash
# Pull from ECR
docker pull 123456789012.dkr.ecr.us-east-1.amazonaws.com/cloud-dashboard:latest

# Tag for Minikube's use
docker tag 123456789012.dkr.ecr.us-east-1.amazonaws.com/cloud-dashboard:latest cloud-dashboard:latest

# Load into Minikube's Docker daemon
minikube image load cloud-dashboard:latest

# Verify the image is in Minikube
minikube image ls | grep cloud-dashboard
```

---

## PHASE 7 — Deploy to Kubernetes

### Create the YAML files on EC2:
```bash
mkdir k8s && cd k8s
```

### Create deployment.yaml:
```bash
cat > deployment.yaml << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloud-dashboard
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloud-dashboard
  template:
    metadata:
      labels:
        app: cloud-dashboard
    spec:
      containers:
        - name: cloud-dashboard
          image: cloud-dashboard:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: "production"
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          resources:
            requests:
              memory: "64Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
EOF
```

### Create service.yaml:
```bash
cat > service.yaml << 'EOF'
apiVersion: v1
kind: Service
metadata:
  name: cloud-dashboard-service
  namespace: default
spec:
  type: NodePort
  selector:
    app: cloud-dashboard
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
      nodePort: 30080
EOF
```

### Apply to Kubernetes:
```bash
cd k8s
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

### Verify Deployment:
```bash
# Check pods (wait for STATUS = Running)
kubectl get pods

# Check services (note the NodePort)
kubectl get services

# Check deployment
kubectl get deployments

# View pod logs
kubectl logs -l app=cloud-dashboard

# Describe pod for details
kubectl describe pod -l app=cloud-dashboard
```

---

## PHASE 8 — Access the Application

### Find Minikube IP:
```bash
minikube ip
# Example output: 192.168.49.2
```

### Port-forward from Minikube to EC2 (run in background):
```bash
# Option A — kubectl port-forward (simplest)
kubectl port-forward service/cloud-dashboard-service 30080:80 --address=0.0.0.0 &

# Option B — Use minikube service tunnel
minikube service cloud-dashboard-service --url
```

### Access the Application:
```
Open browser: http://<EC2-PUBLIC-IP>:30080
Health check: http://<EC2-PUBLIC-IP>:30080/health
Readiness:    http://<EC2-PUBLIC-IP>:30080/ready
API:          http://<EC2-PUBLIC-IP>:30080/api/dashboard
```

---

## PHASE 9 — Demo Commands (for Video)

```bash
# Show pods
kubectl get pods

# Show services
kubectl get services

# Show all resources
kubectl get all

# Scale to 2 replicas (show in video)
kubectl scale deployment cloud-dashboard --replicas=2
kubectl get pods   # Watch 2 pods appear

# Scale back down
kubectl scale deployment cloud-dashboard --replicas=1

# View logs
kubectl logs -l app=cloud-dashboard --tail=20

# Describe node
kubectl describe node minikube

# Check health endpoint
curl http://localhost:30080/health
curl http://localhost:30080/api/dashboard | python3 -m json.tool
```

---

## PHASE 10 — Clean Up Resources (IMPORTANT — Do After Video)

```bash
# Delete Kubernetes resources
kubectl delete -f k8s/deployment.yaml
kubectl delete -f k8s/service.yaml

# Stop Minikube
minikube stop
minikube delete

# Terminate EC2 Instance
# AWS Console → EC2 → Instances → Select → Terminate Instance

# Delete ECR Repository
aws ecr delete-repository --repository-name cloud-dashboard --force --region us-east-1

# Verify: $0 cost by checking AWS Billing Dashboard
```

---

## GITHUB SETUP

```bash
# On your laptop (not EC2)
cd cloud-dashboard
git init
git add .
git commit -m "feat: Cloud Computing Dashboard - Docker + Kubernetes"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cloud-dashboard.git
git push -u origin main
```

---

## TROUBLESHOOTING

| Problem | Fix |
|---------|-----|
| Pod stuck in `Pending` | `kubectl describe pod <name>` — check events for resource issues |
| Pod stuck in `ImagePullBackOff` | Image not loaded in Minikube — re-run `minikube image load` |
| Can't reach EC2:30080 | Check Security Group has port 30080 open for 0.0.0.0/0 |
| Minikube won't start | Run `minikube delete && minikube start --driver=docker` |
| Docker permission denied | Run `newgrp docker` or logout/login |
| ECR auth fails | Check IAM role attached to EC2 has ECR read permissions |
| Port-forward stops | Run it again with `&` or use `nohup ... &` |

---

## COST ANALYSIS TABLE

| Resource | Free Tier Limit | Our Usage | Cost |
|----------|----------------|-----------|------|
| EC2 t2.micro | 750 hrs/month | ~1 hr demo | $0.00 |
| ECR Storage | 500 MB/month | ~50 MB | $0.00 |
| Data Transfer | 15 GB/month | <1 GB | $0.00 |
| Minikube | Free software | Free | $0.00 |
| Docker | Free software | Free | $0.00 |
| **TOTAL** | | | **$0.00** |
