import React, { useState, useEffect } from 'react';
import { Plus, Timer, TrendingUp, Dumbbell, CheckCircle, LogOut } from 'lucide-react';

// Auth0 Configuration - Replace these with your actual values
const AUTH0_DOMAIN = 'YOUR_AUTH0_DOMAIN';  // e.g., 'dev-abc123.us.auth0.com'
const AUTH0_CLIENT_ID = 'YOUR_AUTH0_CLIENT_ID';
const API_URL = 'http://localhost:5000/api';  // Change to your deployed API URL

const PRESET_EXERCISES = [
  { id: 1, name: 'Squat', muscle_group: 'Legs' },
  { id: 2, name: 'Bench Press', muscle_group: 'Chest' },
  { id: 3, name: 'Deadlift', muscle_group: 'Back' },
  { id: 4, name: 'Overhead Press', muscle_group: 'Shoulders' },
  { id: 5, name: 'Barbell Row', muscle_group: 'Back' },
  { id: 6, name: 'Pull-ups', muscle_group: 'Back' },
  { id: 7, name: 'Dips', muscle_group: 'Chest' },
];

const WORKOUT_TYPES = {
  1: 'Legs',
  2: 'Chest',
  3: 'Back',
  4: 'Arms',
  5: 'Shoulders',
  6: 'Full Body'
};

export default function LiftLogger() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [view, setView] = useState('log');
  const [exercises, setExercises] = useState(PRESET_EXERCISES);
  const [currentWorkout, setCurrentWorkout] = useState(null);
  const [todaySets, setTodaySets] = useState([]);
  const [restTimer, setRestTimer] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  
  const [selectedExercise, setSelectedExercise] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [feel, setFeel] = useState(7);
  const [rpe, setRpe] = useState('');
  const [tempo, setTempo] = useState('normal');
  const [isDropset, setIsDropset] = useState(false);
  const [dropsetParentId, setDropsetParentId] = useState(null);
  const [editingSetId, setEditingSetId] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [bodyWeight, setBodyWeight] = useState('');
  const [workoutType, setWorkoutType] = useState('');
  const [workoutNotes, setWorkoutNotes] = useState('');
  const [showNewExercise, setShowNewExercise] = useState(false);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [newExerciseMuscle, setNewExerciseMuscle] = useState('');

  // Check for auth token on mount
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (token) {
      setAccessToken(token);
      setIsAuthenticated(true);
      fetchUser(token);
    }
    
    // Check for OAuth callback
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('access_token');
      if (token) {
        localStorage.setItem('access_token', token);
        setAccessToken(token);
        setIsAuthenticated(true);
        fetchUser(token);
        window.location.hash = '';
      }
    }
    
    setIsLoading(false);
  }, []);

  // Timer effect
  useEffect(() => {
    let interval;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setRestTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const fetchUser = async (token) => {
    try {
      const response = await fetch(`${API_URL}/user/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data);
      }
    } catch (error) {
      console.error('Error fetching user:', error);
    }
  };

  const login = () => {
    const redirectUri = window.location.origin;
    const authUrl = `https://${AUTH0_DOMAIN}/authorize?` +
      `response_type=token&` +
      `client_id=${AUTH0_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=openid profile email&` +
      `audience=https://liftlogger-api&` +
      `connection=google-oauth2`;
    window.location.href = authUrl;
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    setAccessToken(null);
    setIsAuthenticated(false);
    setUser(null);
    setCurrentWorkout(null);
    setTodaySets([]);
    const returnTo = window.location.origin;
    window.location.href = `https://${AUTH0_DOMAIN}/v2/logout?client_id=${AUTH0_CLIENT_ID}&returnTo=${encodeURIComponent(returnTo)}`;
  };

  const apiCall = async (endpoint, options = {}) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }
    
    return response.json();
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startWorkout = async () => {
    if (!workoutType) {
      alert('Please select a workout type');
      return;
    }
    
    try {
      const workout = await apiCall('/workouts/start', {
        method: 'POST',
        body: JSON.stringify({
          date: new Date().toISOString().split('T')[0],
          workout_type: parseInt(workoutType),
          notes: workoutNotes
        })
      });
      
      setCurrentWorkout({
        ...workout,
        started_at: new Date()
      });
      
      if (bodyWeight) {
        await apiCall('/bodyweight', {
          method: 'POST',
          body: JSON.stringify({
            date: new Date().toISOString().split('T')[0],
            weight: parseFloat(bodyWeight)
          })
        });
      }
    } catch (error) {
      console.error('Error starting workout:', error);
      alert('Failed to start workout. Please try again.');
    }
  };

  const logSet = async () => {
    if (!selectedExercise || !weight || !reps) {
      alert('Please fill in exercise, weight, and reps');
      return;
    }

    const setData = {
      workout_id: currentWorkout.id,
      exercise_id: parseInt(selectedExercise),
      set_number: todaySets.filter(s => s.exercise_id == selectedExercise && !s.is_dropset).length + 1,
      weight: parseFloat(weight),
      reps: parseInt(reps),
      feel_rating: parseInt(feel),
      rpe: rpe ? parseFloat(rpe) : null,
      tempo: tempo,
      rest_time: restTimer,
      is_dropset: isDropset,
      dropset_parent_id: dropsetParentId,
      notes: ''
    };

    try {
      if (editingSetId) {
        const updatedSet = await apiCall(`/sets/${editingSetId}`, {
          method: 'PUT',
          body: JSON.stringify(setData)
        });
        setTodaySets(todaySets.map(s => s.id === editingSetId ? updatedSet : s));
        setEditingSetId(null);
      } else {
        const newSet = await apiCall('/sets', {
          method: 'POST',
          body: JSON.stringify(setData)
        });
        setTodaySets([...todaySets, newSet]);
      }
      
      // Reset form
      setWeight('');
      setReps('');
      setFeel(7);
      setRpe('');
      setTempo('normal');
      
      if (isDropset) {
        setIsDropset(false);
        setDropsetParentId(null);
      }
      
      if (!editingSetId) {
        setRestTimer(0);
        setIsTimerRunning(true);
      }
    } catch (error) {
      console.error('Error logging set:', error);
      alert('Failed to log set. Please try again.');
    }
  };

  const markAsDropset = (setId) => {
    setIsDropset(true);
    setDropsetParentId(setId);
  };

  const cancelDropset = () => {
    setIsDropset(false);
    setDropsetParentId(null);
  };

  const editSet = (set) => {
    setEditingSetId(set.id);
    setSelectedExercise(set.exercise_id);
    setWeight(set.weight.toString());
    setReps(set.reps.toString());
    setFeel(set.feel_rating);
    setRpe(set.rpe ? set.rpe.toString() : '');
    setTempo(set.tempo);
    setIsDropset(set.is_dropset);
    setDropsetParentId(set.dropset_parent_id);
  };

  const deleteSet = async (setId) => {
    if (!confirm('Delete this set?')) return;
    
    try {
      await apiCall(`/sets/${setId}`, { method: 'DELETE' });
      setTodaySets(todaySets.filter(s => s.id !== setId));
    } catch (error) {
      console.error('Error deleting set:', error);
      alert('Failed to delete set.');
    }
  };

  const addNewExercise = async () => {
    if (!newExerciseName) return;
    
    try {
      const exercise = await apiCall('/exercises', {
        method: 'POST',
        body: JSON.stringify({
          name: newExerciseName,
          muscle_group: newExerciseMuscle
        })
      });
      
      setExercises([...exercises, exercise]);
      setSelectedExercise(exercise.id);
      setShowNewExercise(false);
      setNewExerciseName('');
      setNewExerciseMuscle('');
    } catch (error) {
      console.error('Error adding exercise:', error);
      alert('Failed to add exercise.');
    }
  };

  const endWorkout = async () => {
    setIsTimerRunning(false);
    
    try {
      await apiCall(`/workouts/${currentWorkout.id}/end`, { method: 'PUT' });
      setShowSummary(true);
    } catch (error) {
      console.error('Error ending workout:', error);
      alert('Failed to end workout.');
    }
  };

  const finishAndReset = () => {
    setCurrentWorkout(null);
    setTodaySets([]);
    setShowSummary(false);
    setRestTimer(0);
    setIsTimerRunning(false);
    setSelectedExercise('');
    setWeight('');
    setReps('');
    setFeel(7);
    setRpe('');
    setTempo('normal');
    setWorkoutType('');
    setWorkoutNotes('');
    setBodyWeight('');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <Dumbbell className="w-16 h-16 mx-auto mb-4 text-blue-400 animate-pulse" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <Dumbbell className="w-20 h-20 mx-auto mb-6 text-blue-400" />
          <h1 className="text-4xl font-bold mb-4">Lift Logger</h1>
          <p className="text-gray-400 mb-8">Track your workouts, analyze your progress</p>
          
          <button
            onClick={login}
            className="w-full bg-white hover:bg-gray-100 text-gray-900 font-bold py-4 px-6 rounded-lg flex items-center justify-center gap-3 transition"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
          
          <p className="text-sm text-gray-500 mt-6">
            Secure authentication powered by Auth0
          </p>
        </div>
      </div>
    );
  }

  // Start workout screen
  if (!currentWorkout && view === 'log') {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-md mx-auto pt-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-bold">Lift Logger</h1>
              <p className="text-gray-400">Welcome, {user?.name}</p>
            </div>
            <button onClick={logout} className="text-gray-400 hover:text-white">
              <LogOut className="w-6 h-6" />
            </button>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Workout Type</label>
              <select 
                value={workoutType}
                onChange={(e) => setWorkoutType(e.target.value)}
                className="w-full bg-gray-700 rounded px-4 py-3 text-lg"
              >
                <option value="">Select type...</option>
                {Object.entries(WORKOUT_TYPES).map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Body Weight (optional)</label>
              <input
                type="number"
                step="0.1"
                value={bodyWeight}
                onChange={(e) => setBodyWeight(e.target.value)}
                placeholder="lbs"
                className="w-full bg-gray-700 rounded px-4 py-3 text-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Notes (optional)</label>
              <textarea
                value={workoutNotes}
                onChange={(e) => setWorkoutNotes(e.target.value)}
                placeholder="How are you feeling today?"
                className="w-full bg-gray-700 rounded px-4 py-3 text-lg"
                rows="3"
              />
            </div>

            <button
              onClick={startWorkout}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg text-lg"
            >
              Start Workout
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Workout summary screen
  if (showSummary) {
    const exerciseSummary = {};
    todaySets.forEach(set => {
      if (!exerciseSummary[set.exercise_name]) {
        exerciseSummary[set.exercise_name] = {
          sets: 0,
          totalVolume: 0,
          topWeight: 0,
          totalReps: 0
        };
      }
      exerciseSummary[set.exercise_name].sets += 1;
      exerciseSummary[set.exercise_name].totalVolume += set.weight * set.reps;
      exerciseSummary[set.exercise_name].topWeight = Math.max(exerciseSummary[set.exercise_name].topWeight, set.weight);
      exerciseSummary[set.exercise_name].totalReps += set.reps;
    });

    const totalVolume = todaySets.reduce((sum, set) => sum + (set.weight * set.reps), 0);
    const workoutDuration = Math.floor((new Date() - new Date(currentWorkout.started_at)) / 1000 / 60);

    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-2xl mx-auto pt-8">
          <div className="text-center mb-8">
            <div className="bg-green-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Workout Complete!</h1>
            <p className="text-gray-400">{WORKOUT_TYPES[currentWorkout.workout_type]}</p>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h2 className="font-bold text-xl mb-4">Summary</h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-400">{todaySets.length}</p>
                <p className="text-sm text-gray-400">Total Sets</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-400">{totalVolume.toLocaleString()}</p>
                <p className="text-sm text-gray-400">Total Volume (lbs)</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-400">{workoutDuration}</p>
                <p className="text-sm text-gray-400">Minutes</p>
              </div>
            </div>

            <div className="space-y-4">
              {Object.entries(exerciseSummary).map(([exercise, data]) => (
                <div key={exercise} className="bg-gray-700 rounded-lg p-4">
                  <h3 className="font-bold mb-2">{exercise}</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-400">Sets</p>
                      <p className="font-medium">{data.sets}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Total Reps</p>
                      <p className="font-medium">{data.totalReps}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Top Weight</p>
                      <p className="font-medium">{data.topWeight} lbs</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Volume</p>
                      <p className="font-medium">{data.totalVolume.toLocaleString()} lbs</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={finishAndReset}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg text-lg"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // Main logging screen
  if (view === 'log') {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <div className="bg-gray-800 p-4 sticky top-0 z-10">
          <div className="max-w-md mx-auto flex justify-between items-center">
            <div>
              <h2 className="font-bold text-lg">{WORKOUT_TYPES[currentWorkout.workout_type]}</h2>
              <p className="text-sm text-gray-400">{todaySets.length} sets logged</p>
            </div>
            <div className="flex items-center gap-2 bg-gray-700 px-4 py-2 rounded-lg">
              <Timer className="w-4 h-4 text-blue-400" />
              <span className="font-mono text-lg">{formatTime(restTimer)}</span>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto p-4 space-y-4">
          <div className="bg-gray-800 rounded-lg p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Exercise</label>
              <select 
                value={selectedExercise}
                onChange={(e) => setSelectedExercise(e.target.value)}
                className="w-full bg-gray-700 rounded px-4 py-3 text-lg"
              >
                <option value="">Select exercise...</option>
                {exercises.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowNewExercise(true)}
                className="mt-2 text-blue-400 text-sm flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Add new exercise
              </button>
            </div>

            {showNewExercise && (
              <div className="bg-gray-700 p-3 rounded space-y-2">
                <input
                  type="text"
                  placeholder="Exercise name"
                  value={newExerciseName}
                  onChange={(e) => setNewExerciseName(e.target.value)}
                  className="w-full bg-gray-600 rounded px-3 py-2"
                />
                <input
                  type="text"
                  placeholder="Muscle group"
                  value={newExerciseMuscle}
                  onChange={(e) => setNewExerciseMuscle(e.target.value)}
                  className="w-full bg-gray-600 rounded px-3 py-2"
                />
                <div className="flex gap-2">
                  <button onClick={addNewExercise} className="bg-blue-600 px-4 py-2 rounded flex-1">
                    Add
                  </button>
                  <button onClick={() => setShowNewExercise(false)} className="bg-gray-600 px-4 py-2 rounded">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Weight (lbs)</label>
                <input
                  type="number"
                  step="2.5"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  className="w-full bg-gray-700 rounded px-4 py-3 text-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Reps</label>
                <input
                  type="number"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  className="w-full bg-gray-700 rounded px-4 py-3 text-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">How it felt: {feel}/10</label>
              <input
                type="range"
                min="0"
                max="10"
                value={feel}
                onChange={(e) => setFeel(e.target.value)}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">RPE (optional)</label>
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                value={rpe}
                onChange={(e) => setRpe(e.target.value)}
                placeholder="Rate of Perceived Exertion"
                className="w-full bg-gray-700 rounded px-4 py-3"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Tempo</label>
              <select 
                value={tempo}
                onChange={(e) => setTempo(e.target.value)}
                className="w-full bg-gray-700 rounded px-4 py-3"
              >
                <option value="normal">Normal</option>
                <option value="pause">Pause</option>
                <option value="touch-and-go">Touch & Go</option>
                <option value="full-reset">Full Reset</option>
                <option value="slow-eccentric">Slow Eccentric</option>
              </select>
            </div>

            {isDropset && (
              <div className="bg-orange-900 bg-opacity-30 border border-orange-600 rounded p-3">
                <div className="flex justify-between items-center">
                  <p className="text-orange-400 font-medium text-sm">Logging as dropset</p>
                  <button
                    onClick={cancelDropset}
                    className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={logSet}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-lg text-lg"
            >
              {editingSetId ? 'Update Set' : 'Log Set'}
            </button>
            {editingSetId && (
              <button
                onClick={() => {
                  setEditingSetId(null);
                  setWeight('');
                  setReps('');
                  setFeel(7);
                  setRpe('');
                  setTempo('normal');
                  setIsDropset(false);
                  setDropsetParentId(null);
                }}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 rounded-lg"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="font-bold mb-3">Today's Sets</h3>
            <div className="space-y-2">
              {todaySets.slice().reverse().map((set) => (
                <div key={set.id} className="bg-gray-700 rounded p-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-medium">{set.exercise_name}</p>
                      <p className="text-sm text-gray-400">
                        {set.weight} lbs × {set.reps} reps
                        {set.is_dropset && <span className="ml-2 text-orange-400">(Dropset)</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        Feel: {set.feel_rating}/10
                        {set.rpe && ` • RPE: ${set.rpe}`}
                        {' • '}{set.tempo} • Rest: {formatTime(set.rest_time)}
                      </p>
                    </div>
                    <div className="flex gap-1 ml-2">
                      {!set.is_dropset && (
                        <button
                          onClick={() => markAsDropset(set.id)}
                          className="text-xs bg-gray-600 hover:bg-orange-600 px-2 py-1 rounded"
                        >
                          Drop
                        </button>
                      )}
                      <button
                        onClick={() => editSet(set)}
                        className="text-xs bg-gray-600 hover:bg-blue-600 px-2 py-1 rounded"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteSet(set.id)}
                        className="text-xs bg-gray-600 hover:bg-red-600 px-2 py-1 rounded"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={endWorkout}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-lg text-lg"
          >
            End Workout
          </button>
        </div>
      </div>
    );
  }

  return null;
}