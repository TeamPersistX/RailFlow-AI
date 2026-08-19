from fastapi import FastAPI
from pydantic import BaseModel
from sklearn.ensemble import RandomForestRegressor
import numpy as np

app=FastAPI(title='RailFlow AI Service',version='1.0')
X=np.array([[0,1,0],[5,1,0],[10,2,1],[20,3,1],[30,4,2],[45,5,3],[60,5,4]],float)
y=np.array([2,7,18,35,52,73,92],float)
model=RandomForestRegressor(n_estimators=120,random_state=42).fit(X,y)

class Predict(BaseModel):
    delay:float=0
    occupancy:float=1
    conflicts:float=0

@app.get('/health')
def health():
    return {'ok':True,'model':'RandomForest delay-conflict risk model'}

@app.post('/predict')
def predict(p:Predict):
    risk=float(model.predict([[p.delay,p.occupancy,p.conflicts]])[0])
    risk=max(0,min(100,risk))
    if risk>=65:
        level='HIGH'; rec='Prioritize movement and consider holding the lower-priority conflicting train.'
    elif risk>=30:
        level='MEDIUM'; rec='Monitor the section and prioritize the train with higher delay or operational priority.'
    else:
        level='LOW'; rec='Continue planned movement and keep monitoring live delay.'
    return {'risk':round(risk,2),'level':level,'recommendation':rec}
