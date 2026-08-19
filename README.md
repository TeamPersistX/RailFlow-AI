# RailFlow AI – Prototype

## Demo Login
- Controller ID: `CTRL-DEL-001`
- Password: `railflow123`
- Assigned area: Delhi Division

## Start
### AI service
```powershell
cd ai-service
python -m pip install -r requirements.txt
python main.py
```
### Backend + simulator
```powershell
cd backend
npm install
npm run dev
```
### Frontend
```powershell
cd frontend
npm install
npm run dev
```

The simulator starts automatically with the backend. Login loads the controller's assigned trains. Approving or rejecting a conflict resolves it immediately and the next active conflict becomes available.
